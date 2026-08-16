import { act, render, renderHook, screen } from '@testing-library/react-native';
import { Text, useColorScheme } from 'react-native';

import { COLORS } from './tokens';
import { ThemeProvider, useTheme } from './theme';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockUseColorScheme = useColorScheme as jest.Mock;

describe('ThemeProvider / useTheme', () => {
  afterEach(() => {
    mockUseColorScheme.mockReset();
  });

  it('defaults to the OS scheme — light stays light, everything else falls to dark', async () => {
    mockUseColorScheme.mockReturnValue('light');
    const light = await renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(light.result.current.theme).toBe('light');
    expect(light.result.current.colors).toEqual(COLORS.light);

    mockUseColorScheme.mockReturnValue('dark');
    const dark = await renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(dark.result.current.theme).toBe('dark');

    mockUseColorScheme.mockReturnValue(null);
    const unset = await renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(unset.result.current.theme).toBe('dark');
  });

  it('an explicit setTheme overrides the OS scheme until cleared', async () => {
    mockUseColorScheme.mockReturnValue('dark');
    const { result } = await renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.theme).toBe('dark');

    await act(() => result.current.setTheme('light'));
    expect(result.current.theme).toBe('light');
    expect(result.current.colors).toEqual(COLORS.light);

    await act(() => result.current.setTheme(null));
    expect(result.current.theme).toBe('dark');
  });

  it('throws outside a ThemeProvider — a screen cannot silently render unthemed', async () => {
    const Unwrapped = () => {
      useTheme();
      return null;
    };
    await expect(render(<Unwrapped />)).rejects.toThrow(/ThemeProvider/);
  });

  it('re-renders consumers with the new colours once the theme switches', async () => {
    mockUseColorScheme.mockReturnValue('dark');

    function Probe() {
      const { theme, colors } = useTheme();
      return <Text testID="probe">{`${theme}:${colors.bgCanvas}`}</Text>;
    }

    let setTheme: (theme: 'light' | 'dark' | null) => void = () => {};
    function Harness() {
      setTheme = useTheme().setTheme;
      return <Probe />;
    }

    await render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent(`dark:${COLORS.dark.bgCanvas}`);

    await act(() => setTheme('light'));
    expect(screen.getByTestId('probe')).toHaveTextContent(`light:${COLORS.light.bgCanvas}`);
  });
});
