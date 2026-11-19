//! Processes and machine facts that differ per OS: whether a pid lives, a child in a group of its own (so a timeout
//! or a stop takes its children with it), a program started to outlive Kandinsky, the host name, and a file's identity.

/// Windows creation flags (winbase.h), written out so the core needs no more of the Windows API than it uses.
#[cfg(windows)]
mod flags {
    pub const DETACHED_PROCESS: u32 = 0x0000_0008;
    pub const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
}

/// Whether process `pid` is running.
pub fn pid_alive(pid: u32) -> bool {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        std::path::Path::new(&format!("/proc/{pid}")).exists()
    }
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
    {
        let Ok(pid) = i32::try_from(pid) else { return false };
        // signal 0 checks without sending; EPERM means it exists but is another user's
        unsafe { libc::kill(pid, 0) == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM) }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return false;
            }
            let mut code = 0u32;
            let ok = GetExitCodeProcess(h, &mut code) != 0;
            CloseHandle(h);
            ok && code == STILL_ACTIVE as u32
        }
    }
}

/// Windows: a console program started by the desktop app (which has no console of its own) gets no console window,
/// so a short run (`git status`, a converter) does not flash a black window on the screen. Elsewhere it changes nothing.
pub fn no_window(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(flags::CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// The child gets a process group of its own (Windows: a new group, and no console window flashing up).
pub fn own_group(cmd: &mut tokio::process::Command) {
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(windows)]
    cmd.creation_flags(flags::CREATE_NEW_PROCESS_GROUP | flags::CREATE_NO_WINDOW);
}

/// [`own_group`] for a blocking `std::process::Command` (a run on a thread of its own: js_exec.rs).
pub fn own_group_blocking(cmd: &mut std::process::Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(flags::CREATE_NEW_PROCESS_GROUP | flags::CREATE_NO_WINDOW);
    }
}

/// How [`stop_group`] ends a group.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stop {
    /// Asked to end (SIGTERM); Windows has no such ask for a windowless program, so it is ended there too.
    Ask,
    /// Ended now (SIGKILL).
    Kill,
}

/// Ends the group started by [`own_group`] whose leader is `pid`, children included.
pub fn stop_group(pid: u32, how: Stop) {
    if pid == 0 {
        return;
    }
    #[cfg(unix)]
    {
        let sig = match how {
            Stop::Ask => "-TERM",
            Stop::Kill => "-KILL",
        };
        let _ = std::process::Command::new("kill").args([sig, "--", &format!("-{pid}")]).status();
    }
    #[cfg(windows)]
    {
        let _ = how;
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(flags::CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

/// What a helper process started and left running, ended with it once it has exited itself (a worker, a `sh -c`
/// child). Unix: its process group ([`own_group`]). Windows keeps no group once the leader is gone, so the process is put
/// in a job object, which also ends what is left in it when the job is dropped; a program that must outlive it (a
/// viewer it opens) can still leave the job (`CREATE_BREAKAWAY_FROM_JOB`).
pub struct Job {
    #[cfg(unix)]
    group: Option<i32>,
    #[cfg(windows)]
    handle: windows_sys::Win32::Foundation::HANDLE,
}

// SAFETY: a job object handle may be used and closed from any thread
#[cfg(windows)]
unsafe impl Send for Job {}
#[cfg(windows)]
unsafe impl Sync for Job {}

impl Job {
    /// The job of `child`, just spawned in a group of its own. Where none can be made, ending it does nothing.
    pub fn of(child: &tokio::process::Child) -> Self {
        #[cfg(unix)]
        {
            Self { group: child.id().and_then(|p| i32::try_from(p).ok()).filter(|g| *g > 1) }
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            };
            let none = Self { handle: std::ptr::null_mut() };
            let Some(process) = child.raw_handle() else { return none };
            // SAFETY: an unnamed job with default security; its handle is closed here on failure, or by Drop
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return none;
                }
                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
                let set = SetInformationJobObject(job, JobObjectExtendedLimitInformation, (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(), std::mem::size_of_val(&info) as u32);
                if set == 0 || AssignProcessToJobObject(job, process as _) == 0 {
                    CloseHandle(job);
                    return none;
                }
                Self { handle: job }
            }
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = child;
            Self {}
        }
    }

    /// Ends what is left of the job, its leader having exited. Unix: only while the group still has a member, as its
    /// number cannot be given to another process until the last is gone.
    pub fn end(&self) {
        #[cfg(unix)]
        if let Some(group) = self.group {
            // SAFETY: plain signal calls on a process group id; signal 0 only checks that the group has a member
            unsafe {
                if libc::kill(-group, 0) == 0 {
                    libc::kill(-group, libc::SIGTERM);
                }
            }
        }
        #[cfg(windows)]
        if !self.handle.is_null() {
            // SAFETY: a job handle this value owns; exit code 1, never STILL_ACTIVE (259), which `pid_alive` reads as running
            unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.handle, 1) };
        }
    }
}

#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            // SAFETY: the handle is this value's own, closed once; the job's last handle closing ends what is left in it
            unsafe { windows_sys::Win32::Foundation::CloseHandle(self.handle) };
        }
    }
}

/// The program outlives the one starting it: not in its group (Unix), not on its console (Windows).
pub fn detach(cmd: &mut std::process::Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(flags::DETACHED_PROCESS | flags::CREATE_NEW_PROCESS_GROUP);
    }
}

/// The CPU time the calling thread has used, or `None` where it cannot be read. A JS helper's time limit counts this,
/// not the clock: on a busy machine (a compile on every core, memory under pressure) a thread waits, and waiting is not
/// a loop that does not end.
pub fn thread_cpu() -> Option<std::time::Duration> {
    #[cfg(unix)]
    {
        let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        // SAFETY: a valid out-pointer; the clock id is a constant every Unix target here has
        if unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut ts) } == 0 {
            return Some(std::time::Duration::new(ts.tv_sec as u64, ts.tv_nsec as u32));
        }
        None
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::FILETIME;
        use windows_sys::Win32::System::Threading::{GetCurrentThread, GetThreadTimes};
        let z = || FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let (mut c, mut e, mut k, mut u) = (z(), z(), z(), z());
        // SAFETY: the pseudo-handle of this thread and four valid out-pointers
        if unsafe { GetThreadTimes(GetCurrentThread(), &mut c, &mut e, &mut k, &mut u) } == 0 {
            return None;
        }
        let ticks = |f: &FILETIME| ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64; // 100 ns each
        Some(std::time::Duration::from_nanos((ticks(&k) + ticks(&u)) * 100))
    }
    #[cfg(not(any(unix, windows)))]
    None
}

/// Resident set / working-set size of this process in bytes, when the OS reports it.
pub fn rss_bytes() -> Option<usize> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let pages: usize = std::fs::read_to_string("/proc/self/statm")
            .ok()?
            .split_whitespace()
            .nth(1)?
            .parse()
            .ok()?;
        let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        let step = usize::try_from(page_size).ok().filter(|&n| n > 0).unwrap_or(4096);
        pages.checked_mul(step)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
        use windows_sys::Win32::System::Threading::GetCurrentProcess;
        let mut pmc: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
        pmc.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        // SAFETY: `GetCurrentProcess()` returns a valid pseudo-handle and `pmc` is a valid initialized struct.
        let ok = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut pmc, pmc.cb) };
        (ok != 0).then_some(pmc.WorkingSetSize)
    }
    #[cfg(not(any(target_os = "linux", target_os = "android", windows)))]
    {
        None
    }
}

/// This machine's name ("" when unknown).
pub fn hostname() -> String {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    if let Ok(h) = std::fs::read_to_string("/proc/sys/kernel/hostname") {
        return h.trim().to_string();
    }
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        if unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) } == 0 {
            let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            return String::from_utf8_lossy(&buf[..end]).trim().to_string();
        }
    }
    ["HOSTNAME", "COMPUTERNAME"].iter().find_map(|v| std::env::var(v).ok()).unwrap_or_default().trim().to_string()
}

/// A number that changes when a path names another file: the inode on Unix. Windows' file index needs an open
/// handle, so there the creation time stands in — a save writes a new file and renames it over, which is new.
pub fn file_id(meta: &std::fs::Metadata) -> u64 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        meta.ino()
    }
    #[cfg(not(unix))]
    {
        meta.created().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_process_is_alive() {
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(u32::MAX - 7));
    }

    #[test]
    fn a_hostname_is_known() {
        assert!(!hostname().is_empty());
    }

    #[test]
    fn rss_is_positive_on_supported_hosts() {
        if cfg!(any(target_os = "linux", target_os = "android", windows)) {
            assert!(rss_bytes().unwrap_or(0) > 0);
        }
    }
}
