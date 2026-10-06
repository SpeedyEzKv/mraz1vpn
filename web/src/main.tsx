import { render } from 'preact';
import { App } from './app';
import './design/tokens.css';
import './design/base.css';
import './design/components.css';
import { setupTelegramChrome } from './lib/telegram';

setupTelegramChrome();
render(<App />, document.getElementById('root')!);
