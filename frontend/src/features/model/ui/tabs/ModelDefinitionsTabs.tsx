import { Tab, Tabs } from '@mui/material';
import type { MetadataOption, TabKey } from '../../domain/types';

const mapKey = (key: string): TabKey => (key === 'support_domain' ? 'supportDomain' : 'hierarchyModel');

export function ModelDefinitionsTabs({ tabs, value, onChange }: { tabs: MetadataOption[]; value: TabKey; onChange: (value: TabKey) => void }) {
  const safeTabs = tabs.length ? tabs : [
    { key: 'hierarchy_model', label: 'Hierarchy Model' },
    { key: 'support_domain', label: 'Support Domain' },
  ];

  return (
    <Tabs value={value} onChange={(_event, next) => onChange(next)}>
      {safeTabs.map((tab) => (
        <Tab key={tab.key} value={mapKey(tab.key)} label={tab.label} />
      ))}
    </Tabs>
  );
}
