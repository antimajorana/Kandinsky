// Built from helper/helper.ts by scripts/dev/plugin-ui.mjs: edit the sources, not this file.
(function() {
	//#region plugins/beta/manga/helper/helper.ts
	kandinsky.methods({ 
	/** {path} (vault-relative .cbr/.cb7/.cbt) → {path}: its .cbz in the cache (vault-relative), made on first ask. */
as_cbz: async (params) => ({ path: kandinsky.convert.comicToCbz(String(params.path ?? "")) }) });
	//#endregion
})();
