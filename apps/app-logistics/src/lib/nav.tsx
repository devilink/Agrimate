/**
 * A small stack navigator with Android back support. It replaces a navigation library, which keeps the bundle small
 * and avoids native dependencies. Lower screens stay mounted but hidden, so that forms keep their state and going
 * back costs no network request.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { BackHandler, View } from 'react-native';

export interface Route { key: number; name: string; params: unknown }
interface Nav {
  push: (name: string, params?: unknown) => void;
  pop: () => void;
  replace: (name: string, params?: unknown) => void;
  depth: number;
}

const NavContext = createContext<Nav | null>(null);
const FocusContext = createContext(true);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav must be used inside a Navigator');
  return nav;
}
export const useIsFocused = () => useContext(FocusContext);

export type ScreenMap = Record<string, ComponentType<{ params: any }>>;

export function Navigator({ screens, initial }: { screens: ScreenMap; initial: string }) {
  const nextKey = useRef(1);
  const [stack, setStack] = useState<Route[]>([{ key: 0, name: initial, params: undefined }]);

  const push = useCallback((name: string, params?: unknown) => setStack((s) => [...s, { key: nextKey.current++, name, params }]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const replace = useCallback((name: string, params?: unknown) => setStack((s) => [...s.slice(0, -1), { key: nextKey.current++, name, params }]), []);
  const nav = useMemo(() => ({ push, pop, replace, depth: stack.length }), [push, pop, replace, stack.length]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length <= 1) return false;
      pop();
      return true;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  return (
    <NavContext.Provider value={nav}>
      {stack.map((route, i) => {
        const Screen = screens[route.name];
        const focused = i === stack.length - 1;
        if (!Screen) return null;
        return (
          <View key={route.key} style={focused ? { flex: 1 } : { display: 'none' }}>
            <FocusContext.Provider value={focused}><Screen params={route.params} /></FocusContext.Provider>
          </View>
        );
      })}
    </NavContext.Provider>
  );
}
