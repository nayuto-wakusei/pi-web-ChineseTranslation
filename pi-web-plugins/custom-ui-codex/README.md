# Custom UI Codex

PI WEB 的可选 Lit 展示插件，随包提供且默认启用。插件 ID 为 `pi-web.custom-ui-codex`，提供 Codex 风格导航、聊天外围布局、设置导航及 Paper / Graphite 明暗主题；消息、编辑器、会话状态与权限仍由宿主持有。

导航将当前选中项目、工作区与会话组合为嵌套分支，普通文件夹省略重复的工作区层；顶部提供新会话、搜索及添加项目入口，设置位于底部。标题栏以文字“操作”按钮打开宿主操作面板，不显示闪电图标。侧栏使用浅薄荷色或深炭色，聊天输入区居中、最大宽度为 816px。桌面设置采用全屏布局与 240px 导航栏，窄屏改为可横向滚动的分区导航。可用操作遵循宿主权限，管理视图不增加普通模式操作。

输入框下方紧邻显示与输入内容对齐的上下文用量和会话费用，沿用宿主状态条的数据、计算与警告操作；发送按钮左侧不显示分隔线。主操作位空闲时显示发送，运行中常显停止，不依赖悬停、焦点或草稿；独立引导按钮与键盘排队仍使用宿主行为。这些展示调整仅由插件样式提供，关闭插件后恢复宿主默认表现。

树形布局只展开当前选中分支，项目和工作区通过节点按钮展开或收起，手机端也不使用单层互斥折叠；定向定位会话会先展开所选祖先。数据仍由宿主按选择加载，不同时读取未选中项目的会话。左侧附件按钮的来源菜单采用起始对齐，在窄屏保留可读空间。上传、删除、附件移除、信任和会话菜单继续使用原有功能；切换展示不重建消息视图和输入编辑器，不清除草稿或附件。

在网关的插件设置中禁用，或在有效机器配置中设置：

```json
{
  "plugins": {
    "pi-web.custom-ui-codex": { "enabled": false }
  }
}
```

刷新页面后恢复宿主默认界面。单独启停此浏览器插件不要求重启 daemon，中文语言插件与普通/管理模式权限保持独立。配置与主题兼容规则见[配置参考](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/docs/config.md#default-theme-and-streaming)，公开展示区域契约见[插件指南](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/docs/plugins.md#ui-presentation)。

## 设计与比较基线

布局设计参考 [DSH Codex UI 的固定版本 `0e1b22b4`](https://github.com/MichengAI/dsh-codex-ui/tree/0e1b22b42fdbeea5d528abcb922d9ed4d2ae3c82)（Apache-2.0），面向 PI WEB 复用其视觉语言与布局组织，不宣称像素级一致或包含 DSH 的全部功能。这是 PI WEB 原生实现，不包含该项目的代码或品牌素材，也不加载 DSH 或 React 运行时。工具图标使用 Lucide，许可与署名见 `LICENSE-icons`。

核心默认视觉的比较基线固定为上游 [`2546a98803ac949c3a88b74a014df772c02327af`](https://github.com/jmfederico/pi-web/commit/2546a98803ac949c3a88b74a014df772c02327af)。此标记用于核对布局与控件，不代表已合并该提交包含的全部功能、API 或后端行为。本地性能比较的原始源码基线为含普通文件夹信任修复的 [`3ce6b61b`](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/commit/3ce6b61b)；复现方式和测量边界见[开发检查](https://github.com/nayuto-wakusei/pi-web-ChineseTranslation/blob/main/docs/development-checks.md#web-ui-performance)。
