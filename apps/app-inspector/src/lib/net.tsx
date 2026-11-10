import * as Network from 'expo-network';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface NetState { online: boolean; weak: boolean }
const NetContext = createContext<NetState>({ online: true, weak: false });

/**
 * `online` means "connected to a network". Internet reachability only produces a softer warning, because Android
 * reports it as false on a LAN with no internet, which is exactly how a development API is reached.
 */
function read(s: Network.NetworkState): NetState {
  return { online: s.isConnected !== false, weak: s.isConnected !== false && s.isInternetReachable === false };
}

export function NetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NetState>({ online: true, weak: false });
  useEffect(() => {
    let alive = true;
    Network.getNetworkStateAsync().then((s) => { if (alive) setState(read(s)); }).catch(() => undefined);
    const sub = Network.addNetworkStateListener((s) => setState(read(s)));
    return () => { alive = false; sub.remove(); };
  }, []);
  return <NetContext.Provider value={state}>{children}</NetContext.Provider>;
}

export const useNet = () => useContext(NetContext);
