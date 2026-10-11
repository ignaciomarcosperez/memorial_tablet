import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WebViewComponent, { PAGE_ALIVE_TIMEOUT_MS } from '../src/components/WebViewComponent';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));

const URL = 'https://example.test/display/token';
const ALIVE = JSON.stringify({ type: 'KIOSK_PAGE_ALIVE' });

async function mount(url = URL) {
  const onRenderProcessGone = jest.fn();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <WebViewComponent {...({ url, autoReload: true, onRenderProcessGone } as any)} />,
    );
  });
  const webView = tree.root.findAll((n) => typeof n.props.onMessage === 'function')[0]!;
  const send = async (data: string) => {
    await ReactTestRenderer.act(async () => {
      webView.props.onMessage({ nativeEvent: { data } });
    });
  };
  const wait = async (ms: number) => {
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(ms);
    });
  };
  return { onRenderProcessGone, send, wait, tree };
}

describe('page-alive watchdog', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
  });
  afterEach(() => jest.useRealTimers());

  it('never touches a page that does not report alive', async () => {
    const { onRenderProcessGone, wait } = await mount();
    await wait(10 * 60_000);
    expect(onRenderProcessGone).not.toHaveBeenCalled();
  });

  it('remounts a page that stops reporting alive', async () => {
    const { onRenderProcessGone, send, wait } = await mount();
    await send(ALIVE);
    await wait(PAGE_ALIVE_TIMEOUT_MS - 30_000);
    await send(ALIVE); // sigue viva
    await wait(PAGE_ALIVE_TIMEOUT_MS - 30_000);
    expect(onRenderProcessGone).not.toHaveBeenCalled();
    await wait(60_000); // calla más de 2 min
    expect(onRenderProcessGone).toHaveBeenCalledWith(false);
  });

  it('after a restart, watches from the start a URL that proved it reports alive', async () => {
    const first = await mount();
    await first.send(ALIVE);
    await ReactTestRenderer.act(async () => first.tree.unmount());

    // Nueva instancia (reinicio): la página no llega a cargar ni a latir.
    const second = await mount();
    await second.wait(PAGE_ALIVE_TIMEOUT_MS + 30_000);
    expect(second.onRenderProcessGone).toHaveBeenCalledWith(false);

    // Otra URL no queda vigilada por la de antes.
    const other = await mount('https://other.test/');
    await other.wait(PAGE_ALIVE_TIMEOUT_MS + 30_000);
    expect(other.onRenderProcessGone).not.toHaveBeenCalled();
  });
});
