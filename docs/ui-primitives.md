# 共享 UI 导航

共享控件的表现与生命周期由基础 UI 和浏览器宿主持有；页面与插件保留领域状态、事件、语义、键盘交互及焦点职责。优先沿用已有原生控件与共享模式，不为单个页面复制另一套样式或交互。

- 架构与状态归属见[架构](development/architecture.md)，聊天滚动与未读见[会话](modules/sessions.md#聊天布局不变量)。
- 插件通过公开 `stylesheet-integration` 能力注册 shadow root，并按需选择 `{ sharedUi: true }`；公共契约见[插件指南](plugins.md#styles-highlighting-and-display)，不深导入私有客户端样式。
- 基础布局与表现从[基础主题](../src/client/src/theme/base/)查找；原生控件、表单与弹层入口在[共享 UI 目录](../src/client/src/components/ui/)，具体行为以相邻消费者为准。

原生控件须在所属 ShadowRoot 接入共享样式，并在元素上使用匹配的样式类：按钮使用 `ui-button`，标签使用 `ui-tab`，标签容器使用 `ui-tabs`。仅加载共享 CSS 不会自动为未匹配这些类的原生按钮提供统一外观；页面与插件仍负责控件的语义、可访问名称和状态。

命令、模型、导航和认证等二三级选择界面复用 `ui-dialog-search-row`、`ui-dialog-search` 与 `ui-selection-list`、`ui-selection-row`、`ui-selection-option`、`ui-selection-detail`，统一搜索区和选项层级的表现。独立星标、复选框及其语义交互仍由所属组件负责，不与选项主操作合并。

设置分组复用 `ui-settings-section`、`ui-settings-heading`、`ui-settings-list`、`ui-settings-row`、`ui-settings-actions` 和 `ui-settings-summary`。局部 CSS 只补充领域布局，避免覆盖共享控件的悬停、选中、焦点和禁用状态。

窄空间优先按标题、计数与操作分组换行，保留常用操作，不靠缩小字号或隐藏操作避免拥挤。

样式类、内部选择器和视觉布局不是冻结的公共 API；共享能力版本描述集成方法，不保证外观不变。样式调整不能改变原有授权、发送、焦点或滚动语义，真实几何与命中区域应由浏览器验证。
