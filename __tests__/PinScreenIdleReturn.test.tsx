import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import PinScreen, { PIN_IDLE_RETURN_MS } from '../src/screens/PinScreen';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const render = async () => {
  const navigation = { navigate: jest.fn() };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<PinScreen navigation={navigation as never} />);
  });
  return { navigation, tree };
};

describe('PinScreen idle return', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('goes back to the kiosk after a while without touches', async () => {
    const { navigation } = await render();
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(PIN_IDLE_RETURN_MS - 1);
    });
    expect(navigation.navigate).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Kiosk');
  });

  it('keeps waiting while someone is typing the PIN', async () => {
    const { navigation, tree } = await render();
    const screen = tree.root.findByProps({ testID: 'pin-screen' });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(PIN_IDLE_RETURN_MS - 1000);
      screen.props.onTouchStart();
      jest.advanceTimersByTime(PIN_IDLE_RETURN_MS - 1000);
    });
    expect(navigation.navigate).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Kiosk');
  });
});
