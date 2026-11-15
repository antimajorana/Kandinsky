// Antigravity helper (QuickJS): inspects agy CLI status, configured MCP servers, and registers Kandinsky's MCP server on request.

async function inspectAgy(params = {}) {
  let installed = false;
  let mcpText = "";
  let modelsText = "";
  let kandinskyMcpConnected = false;

  try {
    const mcpRes = await atlas.exec("agy", ["mcp", "list"], { timeout: 10 });
    installed = mcpRes.status === 0 || Boolean(mcpRes.stdout || mcpRes.stderr);
    mcpText = String(mcpRes.stdout || "").trim();
    kandinskyMcpConnected = /\b(kandinsky|atlas)\b/i.test(mcpText);
  } catch (e) {
    return {
      installed: false,
      kandinskyMcpConnected: false,
      mcpText: "",
      models: [],
      error: String((e && e.message) || e),
    };
  }

  if (params.includeModels) {
    try {
      const mRes = await atlas.exec("agy", ["models"], { timeout: 10 });
      modelsText = String(mRes.stdout || "").trim();
    } catch {}
  }

  const models = modelsText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^available/i.test(l) && !/^[-=]+$/.test(l))
    .slice(0, 20);

  return {
    installed,
    kandinskyMcpConnected,
    mcpText,
    models,
  };
}

async function connectKandinskyMcp(params = {}) {
  const cliPath = String(
    params.kandinskyExe || "C:/Users/antimajorana/AppData/Local/Atlas/kandinsky.exe",
  ).trim();

  // Remove any stale registration first (ignore failure if not present), then add fresh.
  try {
    await atlas.exec("agy", ["mcp", "remove", "kandinsky"], { timeout: 8 });
  } catch {}

  const addRes = await atlas.exec("agy", ["mcp", "add", "kandinsky", cliPath, "mcp"], {
    timeout: 15,
  });
  const after = await inspectAgy({ includeModels: false });
  return {
    ok: addRes.status === 0 || after.kandinskyMcpConnected,
    stdout: String(addRes.stdout || "").trim(),
    stderr: String(addRes.stderr || "").trim(),
    status: after,
  };
}

atlas.methods({
  status: inspectAgy,
  connectMcp: connectKandinskyMcp,
  commands: async () => [
    { value: "agy", label: "agy (interactive default)" },
    { value: "agy --mode auto", label: "agy --mode auto" },
    { value: "agy --mode accept-edits", label: "agy --mode accept-edits" },
    { value: "agy --mode plan", label: "agy --mode plan" },
  ],
});
