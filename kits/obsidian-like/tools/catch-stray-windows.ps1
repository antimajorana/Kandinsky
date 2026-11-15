# Watches Atlas while you use it and writes down every program Atlas starts and every new window
# that appears from Atlas (or a black console window), with the time. It only looks; it changes nothing.
#   catch-stray-windows.ps1                       watch for 60 minutes
#   catch-stray-windows.ps1 -Minutes 10           watch for 10 minutes
# Stop it any time by closing its window (or Ctrl+C). The notes go to stray-windows-log.txt in the kit.
param(
    [double]$Minutes = 60,
    [string[]]$Names = @('kandinsky-app.exe', 'kandinsky.exe', 'kandinsky-capture.exe', 'atlas-app.exe', 'atlas.exe', 'atlas-capture.exe'),
    [string]$Log = (Join-Path (Split-Path -Parent $PSScriptRoot) 'stray-windows-log.txt'),
    [int]$IntervalMs = 100
)
$ErrorActionPreference = 'Stop'

if (-not ('StrayWin' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class StrayWin {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PE32 {
        public uint dwSize, cntUsage, th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID, cntThreads, th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h, ref PE32 e);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr h, ref PE32 e);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    public class Proc { public uint Pid; public uint Parent; public string Name; }
    public static List<Proc> Processes() {
        var list = new List<Proc>();
        IntPtr h = CreateToolhelp32Snapshot(2, 0);
        if (h == IntPtr.Zero || h == new IntPtr(-1)) return list;
        var e = new PE32();
        e.dwSize = (uint)Marshal.SizeOf(typeof(PE32));
        if (Process32FirstW(h, ref e)) {
            do { list.Add(new Proc { Pid = e.th32ProcessID, Parent = e.th32ParentProcessID, Name = e.szExeFile }); }
            while (Process32NextW(h, ref e));
        }
        CloseHandle(h);
        return list;
    }

    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);

    public class Win { public long Handle; public uint Pid; public string Title; public string Class; }
    public static List<Win> Windows() {
        var list = new List<Win>();
        EnumWindows((h, l) => {
            if (IsWindowVisible(h)) {
                uint pid; GetWindowThreadProcessId(h, out pid);
                var t = new StringBuilder(256); GetWindowTextW(h, t, 256);
                var c = new StringBuilder(256); GetClassNameW(h, c, 256);
                list.Add(new Win { Handle = h.ToInt64(), Pid = pid, Title = t.ToString(), Class = c.ToString() });
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
'@
}

$consoleClasses = @('ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS', 'PseudoConsoleWindow')
$quiet = @('msedgewebview2.exe')   # Atlas's page engine starts many of these by design: counted, not listed

function Note([string]$text, [string]$color = 'Gray') {
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $text
    Write-Host $line -ForegroundColor $color
    Add-Content -LiteralPath $Log -Value $line -Encoding UTF8
}

function Hint([string]$name, [string]$parent) {
    $n = $name.ToLower(); $p = "$parent".ToLower()
    if ($n -in @('kandinsky-capture.exe', 'atlas-capture.exe') -and $p -eq 'explorer.exe') { return 'the capture box, opened by its shortcut key (Ctrl+Alt+Shift+C) or the Start menu' }
    if ($n -in @('kandinsky-capture.exe', 'atlas-capture.exe')) { return 'the capture box' }
    if ($n -in @('kandinsky-app.exe', 'atlas-app.exe') -and $p -in @('kandinsky-app.exe', 'atlas-app.exe')) { return 'Kandinsky opened another window of its own (another vault, or a folder as a guest)' }
    if ($n -in @('kandinsky-app.exe', 'atlas-app.exe')) { return 'a Kandinsky window was started' }
    if ($n -eq 'conhost.exe') { return 'a console (black text window) was created for the program above: if a black window flashed, this is it' }
    if ($n -in @('cmd.exe', 'sh.exe', 'bash.exe', 'powershell.exe', 'pwsh.exe', 'kandinsky.exe', 'atlas.exe', 'git.exe', 'node.exe', 'python.exe', 'pythonw.exe')) { return 'a helper program Kandinsky runs; console programs like this can flash a black window' }
    return ''
}

$deadline = (Get-Date).AddMinutes($Minutes)
$seenProcs = New-Object 'System.Collections.Generic.HashSet[string]'
$seenWins  = New-Object 'System.Collections.Generic.HashSet[long]'
foreach ($p in [StrayWin]::Processes()) { [void]$seenProcs.Add("$($p.Pid)|$($p.Name)") }
foreach ($w in [StrayWin]::Windows())   { [void]$seenWins.Add($w.Handle) }
$quietCount = 0

Note ("Watching for {0} minutes. Use Atlas as usual; when a stray window appears, note the time. Close this window to stop." -f $Minutes) 'Cyan'
Note "The notes are written to: $Log" 'Cyan'

while ((Get-Date) -lt $deadline) {
    $procs = [StrayWin]::Processes()
    $byPid = @{}; $children = @{}
    foreach ($p in $procs) {
        $byPid[$p.Pid] = $p
        if (-not $children.ContainsKey($p.Parent)) { $children[$p.Parent] = New-Object System.Collections.ArrayList }
        [void]$children[$p.Parent].Add($p)
    }
    # Atlas's programs and everything they started
    $family = @{}
    $queue = New-Object System.Collections.Queue
    foreach ($p in $procs) { if ($Names -contains $p.Name.ToLower()) { $family[$p.Pid] = $true; $queue.Enqueue($p.Pid) } }
    while ($queue.Count -gt 0) {
        $id = $queue.Dequeue()
        if ($children.ContainsKey($id)) {
            foreach ($c in $children[$id]) { if (-not $family.ContainsKey($c.Pid) -and $c.Pid -ne $id) { $family[$c.Pid] = $true; $queue.Enqueue($c.Pid) } }
        }
    }
    foreach ($id in @($family.Keys)) {
        $p = $byPid[$id]
        $key = "$($p.Pid)|$($p.Name)"
        if ($seenProcs.Add($key)) {
            if ($quiet -contains $p.Name.ToLower()) { $quietCount++; continue }
            $parentName = if ($byPid.ContainsKey($p.Parent)) { $byPid[$p.Parent].Name } else { '(already gone)' }
            $cmd = ''
            try { $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Pid)" -ErrorAction Stop).CommandLine } catch { }
            if (-not $cmd) { $cmd = '(it ended before its command line could be read)' }
            Note ("PROGRAM STARTED  {0} (pid {1}), started by {2} (pid {3})" -f $p.Name, $p.Pid, $parentName, $p.Parent) 'Yellow'
            Note ("                 command: {0}" -f $cmd)
            $h = Hint $p.Name $parentName
            if ($h) { Note ("                 what it likely is: {0}" -f $h) 'Green' }
        }
    }
    foreach ($w in [StrayWin]::Windows()) {
        if ($seenWins.Add($w.Handle)) {
            $isConsole = $consoleClasses -contains $w.Class
            if ($family.ContainsKey($w.Pid) -or $isConsole) {
                $owner = if ($byPid.ContainsKey($w.Pid)) { $byPid[$w.Pid].Name } else { "pid $($w.Pid)" }
                $kind = if ($isConsole) { 'a console (black text) window' } else { 'a window' }
                Note ("NEW WINDOW       {0}: title '{1}', owned by {2} (pid {3}), class {4}" -f $kind, $w.Title, $owner, $w.Pid, $w.Class) 'Magenta'
            }
        }
    }
    Start-Sleep -Milliseconds $IntervalMs
}
Note ("Stopped. Atlas's page engine also started {0} background process(es), which is normal." -f $quietCount) 'Cyan'
