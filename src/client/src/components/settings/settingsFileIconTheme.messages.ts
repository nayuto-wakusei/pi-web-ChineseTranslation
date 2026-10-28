import { message } from "../../localization/service";

export default {
  heading: message("File icons", "File icon theme settings heading and selector label"),
  scope: message("Applies only in this browser, independently of the color theme.", "Browser-local file icon preference scope"),
  none: message("None", "Option to turn off themed file icons"),
  reset: message("Reset to Material", "Remove the browser file icon override"),
  unavailable: message<{ id: string }>("{id} (unavailable)", "Unavailable saved file icon theme; preserve id"),
  unavailableHelp: message("This icon theme is unavailable. Using Material until it returns.", "Unavailable file icon theme fallback explanation"),
};
