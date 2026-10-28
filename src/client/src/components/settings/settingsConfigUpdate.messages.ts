import { message } from "../../localization/service";

export default {
  enforced: message<{ variable: string }>("Controlled by {variable}", "Environment-enforced setting; variable is an environment variable name"),
  source: message<{ source: string }>("Source: {source}", "Effective setting source reported by the machine"),
  reset: message("Reset saved override", "Remove a writable config setting to inherit defaults"),
  resetSetting: message<{ setting: string }>("Reset saved override for {setting}", "Accessible reset action; setting is a JSON pointer"),
};
