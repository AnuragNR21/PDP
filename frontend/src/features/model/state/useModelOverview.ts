import { useEffect, useState } from 'react';
import { modelDefinitionsApi } from '../api/modelDefinitionsApi';

export function useModelOverview() {
  const [counts, setCounts] = useState({ hierarchyModels: 0, supportDomainModels: 0 });
  useEffect(() => {
    let mounted = true;
    Promise.all([modelDefinitionsApi.listHierarchyModels(), modelDefinitionsApi.listSupportDomainModels()])
      .then(([hierarchyModels, supportDomainModels]) => {
        if (mounted) setCounts({ hierarchyModels: hierarchyModels.length, supportDomainModels: supportDomainModels.length });
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);
  return counts;
}
