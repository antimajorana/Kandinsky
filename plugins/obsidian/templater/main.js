// Templater & Folder Templates for Kandinsky (API v28)
// Reads .obsidian/plugins/templater-obsidian/data.json + plugin settings, expands <% tp.* %> & <%* ... %>,
// registers Alt+E / palette insert command / New… from template, and auto-applies folder templates on file:create.

import {
  expandTemplateText,
  folderFromPath,
  isEmptyOrFrontmatterOnly,
  matchFolderRule,
  normPath,
  noteTitleFromPath,
  parseCustomFolderRules,
} from "./engine.js";

const OBSIDIAN_TEMPLATER_JSON = ".obsidian/plugins/templater-obsidian/data.json";
const FALLBACK_TEMPLATE_DIRS = ["zMeta/Templates", "Templates", "templates", ".kandinsky/templates"];

function humanLabel(templatePath, baseDir) {
  const clean = normPath(templatePath);
  const rel = baseDir && clean.startsWith(`${baseDir}/`) ? clean.slice(baseDir.length + 1) : clean;
  return rel.replace(/\.md$/i, "");
}

async function listMarkdownRecursive(kandinsky, dir, out = []) {
  let entries = [];
  try {
    entries = await kandinsky.list(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.ignored && !e.path.startsWith(".kandinsky/templates")) continue;
    if (e.dir) {
      await listMarkdownRecursive(kandinsky, e.path, out);
    } else if (/\.md$/i.test(e.name)) {
      out.push(e);
    }
  }
  return out;
}

async function fileDates(kandinsky, targetPath, fallback = new Date()) {
  const clean = normPath(targetPath);
  const dir = clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : "";
  const name = clean.includes("/") ? clean.slice(clean.lastIndexOf("/") + 1) : clean;
  try {
    if (dir && !(await kandinsky.exists(dir))) return { ctime: fallback, mtime: fallback };
    const entries = await kandinsky.list(dir);
    const hit = entries.find((e) => e.name === name || normPath(e.path) === clean);
    if (hit?.mtime) {
      const d = new Date(hit.mtime * 1000);
      return { ctime: d, mtime: d };
    }
  } catch {
    // ignore missing folder
  }
  return { ctime: fallback, mtime: fallback };
}

function splitFrontmatter(text) {
  const s = String(text ?? "");
  const m = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/.exec(s);
  return m ? { frontmatterBlock: m[1], body: m[2] } : { frontmatterBlock: "", body: s };
}

export function register(kandinsky) {
  const settings = kandinsky.plugin.settings ?? {};
  const recentlyWritten = new Set();
  let cachedObsidianConfig = null;

  const markRecent = (path) => {
    const p = normPath(path);
    recentlyWritten.add(p);
    setTimeout(() => recentlyWritten.delete(p), 3000);
  };

  async function loadObsidianTemplaterConfig() {
    if (cachedObsidianConfig) return cachedObsidianConfig;
    const cfg = { templatesFolder: "", folderTemplates: [], ignoreFolders: [] };
    try {
      if (await kandinsky.exists(OBSIDIAN_TEMPLATER_JSON)) {
        const raw = await kandinsky.readText(OBSIDIAN_TEMPLATER_JSON);
        const parsed = JSON.parse(raw);
        if (typeof parsed?.templates_folder === "string" && parsed.templates_folder.trim()) {
          cfg.templatesFolder = normPath(parsed.templates_folder);
        }
        if (Array.isArray(parsed?.folder_templates)) {
          for (const r of parsed.folder_templates) {
            if (r && typeof r.template === "string" && r.template.trim()) {
              cfg.folderTemplates.push({
                folder: normPath(r.folder ?? ""),
                template: normPath(r.template),
                source: "obsidian",
              });
            }
          }
        }
        if (Array.isArray(parsed?.ignore_folders_on_creation)) {
          cfg.ignoreFolders = parsed.ignore_folders_on_creation.map(normPath).filter(Boolean);
        }
      }
    } catch {
      // Malformed or missing .obsidian config is safely ignored
    }
    cachedObsidianConfig = cfg;
    return cfg;
  }

  kandinsky.onFilesChanged((paths) => {
    if (!paths.length || paths.some((p) => normPath(p) === OBSIDIAN_TEMPLATER_JSON)) {
      cachedObsidianConfig = null;
    }
  });

  async function candidateTemplateDirs() {
    const obs = await loadObsidianTemplaterConfig();
    const configured = normPath(settings.templates_folder ?? "zMeta/Templates");
    const dirs = [];
    for (const d of [configured, obs.templatesFolder, ...FALLBACK_TEMPLATE_DIRS]) {
      const clean = normPath(d);
      if (clean && !dirs.includes(clean)) dirs.push(clean);
    }
    return dirs;
  }

  async function effectiveRules() {
    const obs = await loadObsidianTemplaterConfig();
    const custom = parseCustomFolderRules(settings.folder_rules);
    return {
      rules: [...custom, ...obs.folderTemplates],
      ignoreFolders: obs.ignoreFolders,
    };
  }

  async function resolveTemplatePath(templateRef) {
    const clean = normPath(templateRef);
    if (!clean) return null;
    const withMd = /\.md$/i.test(clean) ? clean : `${clean}.md`;
    if (await kandinsky.exists(withMd)) return withMd;
    const dirs = await candidateTemplateDirs();
    for (const dir of dirs) {
      const candidate = `${dir}/${withMd}`;
      if (await kandinsky.exists(candidate)) return candidate;
    }
    return null;
  }

  async function discoverTemplates() {
    const dirs = await candidateTemplateDirs();
    const { rules } = await effectiveRules();
    const seen = new Set();
    const list = [];

    for (const dir of dirs) {
      if (!(await kandinsky.exists(dir))) continue;
      const files = await listMarkdownRecursive(kandinsky, dir);
      for (const f of files) {
        const p = normPath(f.path);
        if (seen.has(p)) continue;
        seen.add(p);
        const mappedFolders = rules
          .filter((r) => {
            const rt = /\.md$/i.test(r.template) ? r.template : `${r.template}.md`;
            return rt === p || `${dir}/${rt}` === p;
          })
          .map((r) => r.folder || "/");
        list.push({
          path: p,
          baseDir: dir,
          title: humanLabel(p, dir),
          folders: mappedFolders,
        });
      }
    }
    list.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    return list;
  }

  async function renderTemplateForNote(templatePath, targetPath, opts = {}) {
    const rawTemplate = await kandinsky.readText(templatePath);
    const now = new Date();
    const { ctime, mtime } = await fileDates(kandinsky, targetPath, now);
    let frontmatter = {};
    try {
      if (await kandinsky.exists(targetPath)) {
        frontmatter = await kandinsky.noteProps(targetPath);
      }
    } catch {
      frontmatter = {};
    }

    const nestedSeen = new Set([normPath(templatePath)]);
    const expandNested = async (nestedTplPath) => {
      const np = normPath(nestedTplPath);
      if (nestedSeen.has(np) || !(await kandinsky.exists(np))) return "";
      nestedSeen.add(np);
      const subRaw = await kandinsky.readText(np);
      const subRes = await expandTemplateText(subRaw, {
        kandinsky,
        targetPath,
        title: opts.title,
        now,
        ctime,
        mtime,
        selection: opts.selection ?? "",
        content: opts.content ?? "",
        frontmatter,
        resolveTemplate: resolveTemplatePath,
        expandNested,
      });
      return subRes.text;
    };

    return expandTemplateText(rawTemplate, {
      kandinsky,
      targetPath,
      title: opts.title,
      now,
      ctime,
      mtime,
      selection: opts.selection ?? "",
      content: opts.content ?? "",
      frontmatter,
      resolveTemplate: resolveTemplatePath,
      expandNested,
    });
  }

  async function insertOrApplyTemplate(touch) {
    const activePath = normPath(touch?.path ?? kandinsky.context()?.active?.path ?? "");
    if (!activePath || !/\.md$/i.test(activePath)) {
      kandinsky.toast("Templater", "Open a Markdown note first, or use New → Note from Templater template…", "info");
      return;
    }

    const currentText = await kandinsky.readText(activePath).catch(() => "");
    const hasUnexpandedTags = /<%[\s*_-]?[\s\S]*?%>/.test(currentText);

    kandinsky.pick({
      placeholder: `Template to insert into ${noteTitleFromPath(activePath)}…`,
      tag: "Templater",
      icon: "file-code",
      items: async () => {
        const templates = await discoverTemplates();
        const items = [];
        if (hasUnexpandedTags) {
          items.push({
            value: "__expand_current__",
            title: "Expand <% tp.* %> tags in current note",
            detail: activePath,
            icon: "refresh",
            section: "Current note",
          });
        }
        for (const t of templates) {
          items.push({
            value: t.path,
            title: t.title,
            detail: t.folders.length ? `${t.path} → ${t.folders.join(", ")}/` : t.path,
            icon: "file-text",
            section: "Templates",
          });
        }
        if (!items.length) {
          items.push({
            value: "",
            title: "No templates found",
            detail: "Place .md templates in zMeta/Templates/, Templates/, or .kandinsky/templates/",
          });
        }
        return items;
      },
      onpick: async (chosen) => {
        if (!chosen) return;
        try {
          if (chosen === "__expand_current__") {
            const now = new Date();
            const { ctime, mtime } = await fileDates(kandinsky, activePath, now);
            const frontmatter = await kandinsky.noteProps(activePath).catch(() => ({}));
            const { text: expanded } = await expandTemplateText(currentText, {
              kandinsky,
              targetPath: activePath,
              now,
              ctime,
              mtime,
              selection: touch?.selection ?? "",
              content: currentText,
              frontmatter,
              resolveTemplate: resolveTemplatePath,
            });
            markRecent(activePath);
            await kandinsky.writeText(activePath, expanded);
            kandinsky.toast("Templater", `Expanded tags in ${noteTitleFromPath(activePath)}`, "success", { timeout: 2500 });
            return;
          }

          const { text: expanded } = await renderTemplateForNote(chosen, activePath, {
            selection: touch?.selection ?? "",
            content: currentText,
          });

          // Empty or fleeting-stub note: write the complete expanded template (including frontmatter)
          if (!currentText.trim()) {
            if (touch) {
              touch.replace(expanded);
            } else {
              markRecent(activePath);
              await kandinsky.writeText(activePath, expanded);
            }
            return;
          }
          if (isEmptyOrFrontmatterOnly(currentText)) {
            markRecent(activePath);
            await kandinsky.writeText(activePath, expanded);
            return;
          }

          // Existing note with content: if note already has frontmatter and template also has frontmatter,
          // insert the template's body at the cursor (and merge missing properties cleanly).
          const noteParts = splitFrontmatter(currentText);
          const tplParts = splitFrontmatter(expanded);
          const toInsert = noteParts.frontmatterBlock && tplParts.frontmatterBlock ? tplParts.body : expanded;

          if (touch) {
            if (touch.selection) touch.replace(toInsert);
            else touch.insert(toInsert);
          } else {
            markRecent(activePath);
            const sep = currentText.endsWith("\n") ? "" : "\n";
            await kandinsky.writeText(activePath, `${currentText}${sep}${toInsert}`);
          }
        } catch (err) {
          kandinsky.toast("Templater", err?.message ? String(err.message) : String(err), "error");
        }
      },
    });
  }

  async function createNoteFromTemplate() {
    const templates = await discoverTemplates();
    if (!templates.length) {
      kandinsky.toast("Templater", "No templates found in zMeta/Templates/, Templates/, or .kandinsky/templates/.", "error");
      return;
    }

    kandinsky.pick({
      placeholder: "Choose a Templater template…",
      tag: "Template",
      icon: "file-code",
      items: templates.map((t) => ({
        value: t.path,
        title: t.title,
        detail: t.folders.length ? `${t.path} → ${t.folders.join(", ")}/` : t.path,
        icon: "file-text",
      })),
      onpick: async (tplPath) => {
        if (!tplPath) return;
        const tpl = templates.find((t) => t.path === tplPath);
        const mappedFolder = tpl?.folders?.[0] && tpl.folders[0] !== "/" ? tpl.folders[0] : "";
        const activePath = normPath(kandinsky.context()?.active?.path ?? "");
        const activeDir = /\.md$/i.test(activePath) ? folderFromPath(activePath, true) : "";
        const defaultFolder = mappedFolder || (activeDir && activeDir !== "/" ? activeDir : "");
        const isDaily = /daily/i.test(tpl?.title ?? "");
        const todaySeed = isDaily ? new Date().toLocaleDateString("sv-SE") : "";

        kandinsky.pick({
          placeholder: defaultFolder ? `Note title (created in ${defaultFolder}/)…` : "Note title (or folder/Title)…",
          tag: tpl?.title ?? "New Note",
          icon: "file-text",
          seed: todaySeed,
          items: todaySeed ? [{ value: todaySeed, title: `Create “${todaySeed}”`, detail: defaultFolder ? `${defaultFolder}/${todaySeed}.md` : `${todaySeed}.md` }] : [],
          typed: (typedName) => (typedName.trim() ? `Create “${typedName.trim()}”` : null),
          onpick: async (rawName) => {
            const input = String(rawName ?? "").trim().replace(/\.md$/i, "");
            if (!input) return;
            const hasExplicitFolder = input.includes("/");
            const cleanRel = normPath(input);
            const basePath = hasExplicitFolder
              ? `${cleanRel}.md`
              : (defaultFolder ? `${defaultFolder}/${cleanRel}.md` : `${cleanRel}.md`);

            // Find an unused file path without overwriting existing notes
            let targetPath = basePath;
            let suffix = 2;
            while (await kandinsky.exists(targetPath)) {
              targetPath = `${basePath.replace(/\.md$/i, "")} ${suffix}.md`;
              suffix++;
            }

            try {
              const { text: expanded, movedPath } = await renderTemplateForNote(tplPath, targetPath, {
                title: noteTitleFromPath(targetPath),
              });
              const finalPath = movedPath && !(await kandinsky.exists(movedPath)) ? movedPath : targetPath;
              markRecent(finalPath);
              const created = await kandinsky.createFile(finalPath, expanded);
              if (!created) {
                await kandinsky.writeText(finalPath, expanded);
              }
              kandinsky.open(finalPath);
            } catch (err) {
              kandinsky.toast("Templater", err?.message ? String(err.message) : String(err), "error");
            }
          },
        });
      },
    });
  }

  // Palette command: Templater: Insert or apply template…
  kandinsky.registerCommand({
    id: "insert",
    title: "Templater: Insert or apply template…",
    run: () => insertOrApplyTemplate(null),
  });

  // Editor key: Alt+E inside Markdown notes
  kandinsky.editor.registerKey("Alt+E", (touch) => {
    void insertOrApplyTemplate(touch);
  }, "note");

  // New… menu integration
  kandinsky.registerNew({
    id: "from-template",
    title: "Note from Templater template…",
    detail: "Choose a Templater template and expand <% tp.* %> tags",
    icon: "file-code",
    run: () => createNoteFromTemplate(),
  });

  // Auto-apply folder templates on newly created empty (or frontmatter-only) Markdown notes
  kandinsky.on("file:create", async (ev) => {
    if (settings.auto_folder_templates === false) return;
    const createdPath = normPath(ev.path);
    if (!createdPath || !/\.md$/i.test(createdPath) || recentlyWritten.has(createdPath)) return;

    const tplDirs = await candidateTemplateDirs();
    if (tplDirs.some((d) => createdPath === d || createdPath.startsWith(`${d}/`))) return;

    const { rules, ignoreFolders } = await effectiveRules();
    if (!rules.length) return;

    const matched = matchFolderRule(createdPath, rules, ignoreFolders);
    if (!matched) return;

    const tplPath = await resolveTemplatePath(matched.template);
    if (!tplPath) return;

    let existingText = "";
    try {
      existingText = await kandinsky.readText(createdPath);
    } catch {
      return;
    }

    if (!isEmptyOrFrontmatterOnly(existingText)) return;

    try {
      const { text: expanded } = await renderTemplateForNote(tplPath, createdPath, {
        title: noteTitleFromPath(createdPath),
        content: existingText,
      });
      markRecent(createdPath);
      await kandinsky.writeText(createdPath, expanded);
      kandinsky.toast("Templater", `Applied ${noteTitleFromPath(tplPath)} template`, "info", { timeout: 2200 });
    } catch (err) {
      kandinsky.toast("Templater", err?.message ? String(err.message) : String(err), "error");
    }
  });
}
