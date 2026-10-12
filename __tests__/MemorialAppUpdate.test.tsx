import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import WebViewComponent from '../src/components/WebViewComponent';
import {
  applyAppUpdate,
  kioskInfo,
  parseAppUpdateMessage,
  INSTALL_WAIT_MS,
  resetAppUpdateState,
  UPDATE_RETRY_MS,
} from '../src/utils/memorialAppUpdate';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));

const SHA = 'a'.repeat(64);
const update = { versionCode: 5004, url: 'https://x.test/app.apk', sha256: SHA };
const native = (versionCode = 5003, install = jest.fn().mockResolvedValue('installing')) => ({
  versionCode,
  versionName: '2.0.0-beta.5-dm.3',
  install,
});

beforeEach(() => resetAppUpdateState());

describe('memorial app update', () => {
  it('accepts only a well-formed https release', () => {
    expect(parseAppUpdateMessage({ type: 'KIOSK_APP_UPDATE', ...update })).toEqual(update);
    for (const bad of [
      { ...update, url: 'http://x.test/app.apk' },
      { ...update, sha256: 'nope' },
      { ...update, versionCode: 1.5 },
      { ...update, versionCode: '5004' },
    ]) {
      expect(parseAppUpdateMessage({ type: 'KIOSK_APP_UPDATE', ...bad })).toBeNull();
    }
    expect(parseAppUpdateMessage({ type: 'OTHER', ...update })).toBeNull();
  });

  it('installs a newer version, and only once', async () => {
    const n = native();
    await applyAppUpdate(update, n, 0);
    await applyAppUpdate(update, n, 1000);
    expect(n.install).toHaveBeenCalledTimes(1);
    expect(n.install).toHaveBeenCalledWith(update.url, SHA, 5004);
    expect(kioskInfo(n).lastUpdate).toEqual({ versionCode: 5004, result: 'installing', at: 0 });
  });

  it('tries again an install that never finished', async () => {
    const n = native();
    await applyAppUpdate(update, n, 0);
    await applyAppUpdate(update, n, INSTALL_WAIT_MS - 1);
    expect(n.install).toHaveBeenCalledTimes(1);
    await applyAppUpdate(update, n, INSTALL_WAIT_MS + 1);
    expect(n.install).toHaveBeenCalledTimes(2);
  });

  it('ignores the same or an older version', async () => {
    const n = native(5004);
    await applyAppUpdate(update, n, 0);
    expect(n.install).not.toHaveBeenCalled();
  });

  it('after a failure, retries the same version only hours later', async () => {
    const n = native(5003, jest.fn().mockRejectedValue(new Error('SHA-256 mismatch')));
    await applyAppUpdate(update, n, 0);
    expect(kioskInfo(n).lastUpdate?.result).toBe('failed: SHA-256 mismatch');
    await applyAppUpdate(update, n, UPDATE_RETRY_MS - 1);
    expect(n.install).toHaveBeenCalledTimes(1);
    await applyAppUpdate(update, n, UPDATE_RETRY_MS + 1);
    expect(n.install).toHaveBeenCalledTimes(2);
  });

  it('the WebView answers KIOSK_HELLO with the installed version', async () => {
    const { NativeModules } = require('react-native');
    NativeModules.MemorialUpdateModule = native();
    const injected: string[] = [];
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <WebViewComponent {...({ url: 'https://example.test/display/t' } as any)} />,
      );
    });
    const webView = tree.root.findAll((n) => typeof n.props.onMessage === 'function')[0]!;
    // La WebView simulada es un View: le damos el método que usa el componente para responder a la página.
    for (const node of tree.root.findAll((n) => typeof n.props.onMessage === 'function')) {
      if (node.instance) node.instance.injectJavaScript = (js: string) => injected.push(js);
    }
    await ReactTestRenderer.act(async () => {
      webView.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'KIOSK_HELLO' }) } });
    });
    delete NativeModules.MemorialUpdateModule;
    expect(injected.join('\n')).toContain('__dmKioskInfo');
    expect(injected.join('\n')).toContain('2.0.0-beta.5-dm.3');
  });
});
