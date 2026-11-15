package org.kandinsky.capture;

import java.io.File;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The names data had before the project was renamed (it is based on Atlas; the core's list is
 * crates/kandinsky-core/src/legacy.rs). A vault, a drawing or a note written by an earlier build still uses them, so
 * they are read as the current ones; what is written uses the current names.
 */
public final class Legacy {
    private Legacy() {}

    /** A vault's state folder, and its name before the rename. */
    public static final String STATE_DIR = ".kandinsky", OLD_STATE_DIR = ".atlas";
    /** The value of the Notepad's `shapes` setting that picks the app's own recogniser, and its old spelling. */
    public static final String SHAPES = "kandinsky", OLD_SHAPES = "atlas";
    /** The comment marker of a drawing's companion note (`<!-- kandinsky:drawing …`), and its old spelling. */
    public static final String DRAWING_MARK = "<!-- kandinsky:drawing", OLD_DRAWING_MARK = "<!-- atlas:drawing";
    /** The word before `-note` in a book's note line before the rename (`<!-- atlas-note ch=… -->`). */
    public static final String OLD_NOTE = "atlas";

    /** `vault`'s state folder: `.kandinsky`; `.atlas` in a vault from before the rename that the core has not renamed
     *  yet (it does when it serves the vault: state_dir.rs). Never a second folder beside an old one. */
    public static File stateDir(File vault) {
        File now = new File(vault, STATE_DIR), old = new File(vault, OLD_STATE_DIR);
        return !now.isDirectory() && old.isDirectory() ? old : now;
    }

    /** `stateDir(vault)`, made when the vault has none yet. */
    public static File madeStateDir(File vault) {
        File d = stateDir(vault);
        d.mkdirs();
        return d;
    }

    /** A vault path `rel` (`.kandinsky/…`) in `vault` as it is on disk: under `.atlas/` while that is the vault's folder. */
    public static File inVault(File vault, String rel) {
        String head = STATE_DIR + "/";
        if (rel.startsWith(head)) return new File(stateDir(vault), rel.substring(head.length()));
        return new File(vault, rel);
    }

    /** A note marks a drawing's companion (either spelling). */
    public static boolean isDrawingNote(String text) {
        return text != null && (text.contains(DRAWING_MARK) || text.contains(OLD_DRAWING_MARK));
    }

    /** The Notepad's `shapes` setting names the app's own recogniser (either spelling). */
    public static boolean ownShapes(String setting) { return SHAPES.equals(setting) || OLD_SHAPES.equals(setting); }

    /** Each element's `customData` keys from before the rename (`atlasPage`, `atlasTemplate`, `atlasPen`…) under their
     *  current names, in place; a current key already there wins and the old one is dropped. */
    public static void currentKeys(JSONArray elements) {
        for (int i = 0; elements != null && i < elements.length(); i++) {
            JSONObject e = elements.optJSONObject(i), custom = e == null ? null : e.optJSONObject("customData");
            if (custom != null) currentKeys(custom);
        }
    }

    /** `custom`'s old keys under their current names, in place. */
    public static void currentKeys(JSONObject custom) {
        List<String> old = new ArrayList<>();
        for (Iterator<String> it = custom.keys(); it.hasNext(); ) {
            String k = it.next();
            if (k.length() > 5 && k.startsWith("atlas") && Character.isUpperCase(k.charAt(5))) old.add(k);
        }
        for (String k : old) {
            String now = "kandinsky" + k.substring(5);
            try { if (!custom.has(now)) custom.put(now, custom.get(k)); } catch (JSONException e) { /* kept as it was */ }
            custom.remove(k);
        }
    }
}
