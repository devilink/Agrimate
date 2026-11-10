'use client';
import type { Commodity, CommodityRef } from '@agrimate/api-client';
import { useCallback } from 'react';
import { useI18n } from './i18n';
import { useApi } from './use-api';

/** Commodity and grade names in the farmer's language. Commodities carry translations; grades have only English in the API. */
export function useMasters() {
  const { lang, t, has } = useI18n();
  const { data: commodities, loading, error, reload } = useApi<Commodity[]>('/masters/commodities');

  const commodityName = useCallback((c: Pick<CommodityRef, 'name' | 'names'>) => c.names?.[lang] ?? c.name, [lang]);
  const gradeName = useCallback((commodityCode: string, g: { code: string; name: string }) => {
    const key = `grade.${commodityCode}.${g.code}`;
    return has(key) ? t(key) : g.name;
  }, [has, t]);

  /** The order list sends plain English names, so they are matched against the master to translate them. */
  const namesFromList = useCallback((commodity: string, grade: string) => {
    const c = commodities?.find((x) => x.name === commodity);
    const g = c?.grades.find((x) => x.name === grade);
    return { commodity: c ? commodityName(c) : commodity, grade: c && g ? gradeName(c.code, g) : grade };
  }, [commodities, commodityName, gradeName]);

  return { commodities, loading, error, reload, commodityName, gradeName, namesFromList };
}
