import { message } from "../localization/service";

export default {
  configCompatibility: message<{ name: string }>("config key {name} is deprecated with no replacement; remove it manually (local compatibility remains temporarily)", "Deprecated legacy command config still honored by this fork; name remains unchanged"),
  environmentCompatibility: message<{ name: string }>("environment variable {name} is deprecated with no replacement; remove it manually (local compatibility remains temporarily)", "Deprecated legacy command environment variable still honored by this fork; name remains unchanged"),
  warning: message<{ machine: string; inputs: string }>("{machine}: {inputs}. Support for deprecated agent configuration inputs will be removed in a future release.", "Non-dismissable machine configuration warning. machine is an unchanged machine name; inputs is a localized list of complete deprecation clauses."),
  configReplacement: message<{ name: string; replacement: string }>("config key {name} is deprecated; set {replacement} instead", "Deprecated config key with replacement. Both identifiers must remain unchanged."),
  environmentReplacement: message<{ name: string; replacement: string }>("environment variable {name} is deprecated; set {replacement} instead", "Deprecated environment variable with replacement. Both identifiers must remain unchanged."),
  configIgnored: message<{ name: string }>("config key {name} is deprecated and ignored; remove it, there is no replacement", "Deprecated config key without replacement. name is an unchanged identifier."),
  environmentIgnored: message<{ name: string }>("environment variable {name} is deprecated and ignored; remove it, there is no replacement", "Deprecated environment variable without replacement. name is an unchanged identifier."),
};
