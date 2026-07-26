WallHub Windows Portable
========================

开始使用
--------
双击 WallHub.exe。WallHub 会在后台启动，并使用默认浏览器打开页面。

运行控制
--------
WallHub 运行后会显示在 Windows 通知区域。双击托盘图标可重新打开页面；
右键菜单可打开项目根目录、查看日志、设置启动参数、重新启动或退出 WallHub。
点击“启动参数...”可自行输入传递给 server.js 的参数。保存后 WallHub 会自动重启
并重新打开页面；输入框默认为空，不提供预设参数。

数据位置
--------
设置、下载内容、SteamKit 登录状态、缓存和日志全部保存在此 WallHub 根目录内。
移动整个文件夹即可迁移，升级时请保留 Downloads、SteamKit、logs 和
cache-settings.json、launcher-settings.json。不要在 WallHub 运行时覆盖或删除本目录。

卸载
----
先从托盘菜单退出 WallHub，再删除整个文件夹。需要保留下载或登录状态时，
请先保留对应目录、cache-settings.json 和 launcher-settings.json。
