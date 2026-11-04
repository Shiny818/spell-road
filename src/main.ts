import './style.css';
import { App } from './ui/app';

// タイトル画面のバージョン表記（通信対戦では、みんなが同じ版か確かめるのに使える）
const commit = __APP_COMMIT__ ? `（${__APP_COMMIT__}）` : '';
document.querySelector('#app-version')!.textContent = `Ver ${__APP_VERSION__}${commit}${import.meta.env.DEV ? ' 開発中' : ''}`;

const app = new App();
app.init();

// 開発中のデバッグ用
if (import.meta.env.DEV) Object.assign(window, { app });
