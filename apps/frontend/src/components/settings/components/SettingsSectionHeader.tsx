import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface SettingsSectionHeaderProps {
  title: string;
  isEditing: boolean;
  canEdit: boolean;
  isUpdating: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function SettingsSectionHeader({
  title,
  isEditing,
  canEdit,
  isUpdating,
  onEdit,
  onSave,
  onCancel,
}: Readonly<SettingsSectionHeaderProps>) {
  return (
    <CardHeader
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        isEditing && 'bg-primary/5 border-l-4 border-primary -mx-4 px-4'
      )}
    >
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {isEditing && (
          <Badge variant="secondary" className="text-xs">
            Editing
          </Badge>
        )}
      </div>
      {isEditing ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={isUpdating} onClick={onSave}>
            {isUpdating ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button disabled={!canEdit} onClick={onEdit}>
          {canEdit ? 'Edit Configuration' : 'Editing other section'}
        </Button>
      )}
    </CardHeader>
  );
}
