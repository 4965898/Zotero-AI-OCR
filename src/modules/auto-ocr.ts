import { processOCRForAttachment } from "./context-menu";
import { getPref } from "../utils/prefs";
import { getString } from "../utils/locale";

let notifierID: string | null = null;

export function registerAutoOCR() {
  const callback = {
    notify: async (
      event: string,
      type: string,
      ids: number[] | string[],
      extraData: { [key: string]: any },
    ) => {
      if (!addon?.data.alive) {
        unregisterAutoOCR();
        return;
      }

      if (event !== "add" || type !== "item") return;
      if (!getPref("autoOCR")) return;

      for (const id of ids) {
        try {
          const item = await Zotero.Items.getAsync(id as number);
          if (!item || !item.isAttachment()) continue;
          if (item.attachmentContentType !== "application/pdf") continue;

          const name = item.getDisplayTitle();
          new ztoolkit.ProgressWindow(addon.data.config.addonName)
            .createLine({
              text: getString("progress-auto-ocr", { args: { name } }),
              type: "default",
              progress: 0,
            })
            .show();

          await processOCRForAttachment(item, true);
        } catch (e: any) {
          ztoolkit.log("Auto OCR failed:", e);
        }
      }
    },
  };

  notifierID = Zotero.Notifier.registerObserver(callback, ["item"]);

  Zotero.Plugins.addObserver({
    shutdown: ({ id }) => {
      if (id === addon.data.config.addonID) {
        unregisterAutoOCR();
      }
    },
  });
}

export function unregisterAutoOCR() {
  if (notifierID) {
    Zotero.Notifier.unregisterObserver(notifierID);
    notifierID = null;
  }
}
