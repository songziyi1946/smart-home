import { Button } from '@arco-design/web-react';
import { Download, Smartphone } from 'lucide-react';
import type { Installation } from '../pwa';

export default function InstallApp({ installation }: { installation: Installation }) {
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return <section className="panel settings-install">
    <header><h2><Smartphone size={19} />添加到桌面</h2></header>
    {installation.installed ? <p role="status">已添加到桌面，可从桌面图标打开。</p> : <>
      <p>把家庭工作台放到桌面，下次点图标即可打开。</p>
      {!installation.secure ? <p>请使用家庭工作台的 HTTPS 地址，再添加到桌面。</p>
        : installation.available ? <Button type="primary" icon={<Download size={16} />} loading={installation.pending} onClick={() => void installation.install()}>安装家庭工作台</Button>
        : <p>{apple ? '在 Safari 中打开，点“分享”，选择“添加到主屏幕”，并以 Web App 打开。' : '打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。若没有该选项，可以继续在浏览器中使用。'}</p>}
    </>}
    <small>设备控制需要连接家庭服务；断线时会显示连接状态。</small>
    {installation.error && <p className="settings-error" role="alert">{installation.error}</p>}
  </section>;
}
