import { Check, Globe, Regex } from 'lucide-react';
import { SearchSelect } from './SearchSelect';

interface ProjectSearchInputProps {
  value: string;
  mode: 'all' | 'project';
  onPickProject: (name: string) => void;
  onPickAll: () => void;
  onPickRegex: () => void;
}

export function ProjectSearchInput({
  value,
  mode,
  onPickProject,
  onPickAll,
  onPickRegex,
}: Readonly<ProjectSearchInputProps>) {
  return (
    <SearchSelect<string>
      fetchUrl="/api/report/projects"
      toItems={(d) => (Array.isArray(d) ? (d as string[]) : [])}
      searchText={(p) => p}
      triggerMuted={!(value || mode === 'all')}
      triggerLabel={() => (mode === 'all' ? 'All projects' : value || 'Pick a project…')}
      searchPlaceholder="Search or type project name…"
      emptyText={(s) =>
        s ? `Press Enter to use "${s}"` : 'No projects in the report database yet.'
      }
      onSubmitFreeText={(text, close) => {
        onPickProject(text);
        close();
      }}
      quickActions={(close) => (
        <>
          <PickerItem
            icon={<Globe className="h-3.5 w-3.5 opacity-70" />}
            label="All projects"
            checked={mode === 'all'}
            onClick={() => {
              onPickAll();
              close();
            }}
          />
          <PickerItem
            icon={<Regex className="h-3.5 w-3.5 opacity-70" />}
            label="Regex match…"
            checked={false}
            onClick={() => {
              onPickRegex();
              close();
            }}
          />
          <div className="border-t" />
        </>
      )}
      renderItem={(p, close) => (
        <PickerItem
          key={p}
          label={p}
          checked={mode === 'project' && p === value}
          onClick={() => {
            onPickProject(p);
            close();
          }}
        />
      )}
    />
  );
}

function PickerItem({
  icon,
  label,
  checked,
  onClick,
}: Readonly<{
  icon?: React.ReactNode;
  label: string;
  checked: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 flex items-center gap-2"
    >
      <Check className={`h-3.5 w-3.5 shrink-0 ${checked ? 'opacity-100' : 'opacity-0'}`} />
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
