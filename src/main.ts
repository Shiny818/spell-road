import './style.css';
import { App } from './ui/app';

const app = new App();
app.init();

// 開発中のデバッグ用
if (import.meta.env.DEV) Object.assign(window, { app });
