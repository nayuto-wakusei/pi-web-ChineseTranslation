# 共享 UI 导航

共享控件的表现与生命周期由基础 UI 和浏览器宿主持有；页面与插件保留领域状态、事件、语义、键盘交互及焦点职责。优先沿用已有原生控件与共享模式，不为单个页面复制另一套样式或交互。

- 架构与状态归属见[架构](development/architecture.md)，聊天滚动与未读见[会话](modules/sessions.md#聊天布局不变量)。
- 插件通过公开 `stylesheet-integration` 能力注册 shadow root，并按需选择 `{ sharedUi: true }`；公共契约见[插件指南](plugins.md#styles-highlighting-and-display)，不深导入私有客户端样式。
- 基础布局与表现从[基础主题](../src/client/src/theme/base/)查找；原生控件、表单与弹层入口在[共享 UI 目录](../src/client/src/components/ui/)，具体行为以相邻消费者为准。

原生控件须在所属 ShadowRoot 接入共享样式，并在元素上使用匹配的样式类：按钮使用 `ui-button`，标签使用 `ui-tab`，标签容器使用 `ui-tabs`。仅加载共享 CSS 不会自动为未匹配这些类的原生按钮提供统一外观；页面与插件仍负责控件的语义、可访问名称和状态。

菜单的每个操作项统一使用 `ui-button ui-menu-item` 并接入对应菜单样式，包括本地新增操作；不能只为排序项接入样式、让其他项落回浏览器原生按钮。核心保留上游基础控件表现，可选 `custom-ui-codex` 插件负责定制布局与视觉。结构性定制使用[网关展示区域](plugins.md#ui-presentation)组织宿主插槽；导航的树形布局由宿主组合原有列表，继续使用相同的菜单、信任入口、键盘操作及权限检查，不深查或移动私有 DOM，也不复制编辑器、消息视图与业务状态。关闭插件后恢复核心独立列表，而不是由核心长期保留定制样式。

树形导航的外层滚动边界由展示布局持有，宿主会话列表仍负责分批挂载。外层滚动时，可见性判断受视口和祖先滚动边界裁剪，不能把整个展开列表当作可见区域而连续加载全部批次；滚动归属切换或控件断开后，旧观察不得继续触发加载。此行为属于通用列表生命周期，定制视觉仍归插件。

树模式使用静态分区标题，由项目和工作区节点的展开控件管理所选分支，不复用独立列表在手机上的单层互斥折叠状态。定向定位工作区或会话时，宿主先展开所选祖先，再移动焦点；退出树模式后仍使用原有分区折叠偏好。

展示布局移动锚点按钮时，须同步考虑弹层对齐与可用空间。宿主锚点弹层在未显式指定定位选项时读取面板的 `--ui-popup-placement`，由插件选择适配布局的对齐；宿主继续负责视口约束、焦点及关闭生命周期。可用值与优先级见[插件样式参考](plugins.md#styles-highlighting-and-display)，入口见 [anchoredPopup.ts](../src/client/src/components/anchoredPopup.ts)。

命令、模型、导航和认证等二三级选择界面复用 `ui-dialog-search-row`、`ui-dialog-search` 与 `ui-selection-list`、`ui-selection-row`、`ui-selection-option`、`ui-selection-detail`，统一搜索区和选项层级的表现。独立星标、复选框及其语义交互仍由所属组件负责，不与选项主操作合并。

设置分组复用 `ui-settings-section`、`ui-settings-heading`、`ui-settings-list`、`ui-settings-row`、`ui-settings-actions` 和 `ui-settings-summary`。局部 CSS 只补充领域布局，避免覆盖共享控件的悬停、选中、焦点和禁用状态。

窄空间优先按标题、计数与操作分组换行，保留常用操作，不靠缩小字号或隐藏操作避免拥挤。

样式类、内部选择器和视觉布局不是冻结的公共 API；共享能力版本描述集成方法，不保证外观不变。样式调整不能改变原有授权、发送、焦点或滚动语义，真实几何与命中区域应由浏览器验证。
