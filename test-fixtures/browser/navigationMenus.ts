import { html, render } from "lit";
import { CommandPicker } from "../../src/client/src/components/CommandPicker";
import { ModelPicker } from "../../src/client/src/components/ModelPicker";
import { AuthDialog } from "../../src/client/src/components/AuthDialog";
import { NavigationDialog } from "../../src/client/src/components/appShell/NavigationDialog";

function openModels(): void {
  const picker = new ModelPicker();
  picker.title = "模型选择";
  picker.options = [{ value: "fixture/model", label: "中文模型名称与较长的说明用于验证窄屏布局", description: "fixture" }];
  picker.catalog = [{ provider: "fixture", id: "model", enabled: true }, { provider: "fixture", id: "another-model", enabled: false }];
  picker.selectedValue = "fixture/model";
  picker.defaultValue = "fixture/model";
  picker.onSetDefault = () => Promise.resolve();
  picker.onCancel = () => { picker.remove(); };
  document.body.append(picker);
}

const menuTools = document.createElement("div");
render(html`
  <button @click=${() => {
    const picker = new CommandPicker();
    picker.title = "会话选项";
    picker.searchable = true;
    picker.options = [{ value: "models", label: "选择模型", description: "打开下一级模型选择菜单，保留当前菜单" }];
    picker.onPick = openModels;
    picker.onSetDefault = () => Promise.resolve();
    picker.onCancel = () => { picker.remove(); };
    document.body.append(picker);
  }}>Picker fixture</button>
  <button @click=${() => {
    const dialog = new NavigationDialog();
    dialog.tabs = [{ id: "chat", label: "聊天" }, { id: "fixture:files", label: "工作区文件与更多工具导航" }];
    dialog.onPreferencesChange = (preferences) => { dialog.preferences = preferences; };
    dialog.onClose = () => { dialog.remove(); };
    document.body.append(dialog);
  }}>Navigation fixture</button>
  <button @click=${() => {
    const dialog = new AuthDialog();
    dialog.state = { step: "method", target: { machineId: "local", projectId: "fixture" } };
    dialog.onCancel = () => { dialog.remove(); };
    document.body.append(dialog);
  }}>Auth fixture</button>
`, menuTools);
document.body.prepend(menuTools);
