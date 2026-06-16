import type { HeaderLink } from '@playwright-reports/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getPresetIcon, HEADER_LINK_ICON_CATALOG } from '@/components/header-link-icons';
import { LinkIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CUSTOM_VALUE = '__custom__';
const NONE_VALUE = '__none__';

interface AddLinkModalProps {
  isOpen: boolean;
  onAddLink: (link: HeaderLink, iconFile: File | null) => void;
  onCancel: () => void;
}

export default function AddLinkModal({ isOpen, onAddLink, onCancel }: Readonly<AddLinkModalProps>) {
  const [iconChoice, setIconChoice] = useState<string>(HEADER_LINK_ICON_CATALOG[0].name);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [showLabel, setShowLabel] = useState(false);
  const iconFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setIconChoice(HEADER_LINK_ICON_CATALOG[0].name);
      setIconFile(null);
      setLabel('');
      setUrl('');
      setShowLabel(false);
      if (iconFileRef.current) iconFileRef.current.value = '';
    }
  }, [isOpen]);

  const iconPreviewUrl = useMemo(
    () => (iconFile ? URL.createObjectURL(iconFile) : null),
    [iconFile]
  );
  useEffect(() => {
    return () => {
      if (iconPreviewUrl) URL.revokeObjectURL(iconPreviewUrl);
    };
  }, [iconPreviewUrl]);

  const isCustom = iconChoice === CUSTOM_VALUE;
  const isNone = iconChoice === NONE_VALUE;
  const preset = !isCustom && !isNone ? getPresetIcon(iconChoice) : undefined;
  const PreviewIcon = preset?.Icon ?? LinkIcon;

  const canSubmit = !!url.trim() && (!isCustom || !!iconFile);

  const handleSubmit = () => {
    if (!canSubmit) return;
    const trimmedLabel = label.trim();
    const fallbackLabel = preset?.title ?? '';
    const id = (globalThis.crypto?.randomUUID?.() ?? `link-${Date.now()}`) as string;

    onAddLink(
      {
        id,
        label: trimmedLabel || fallbackLabel,
        url: url.trim(),
        // For custom uploads we leave `icon` blank — the parent will receive
        // the File and the backend will fill in the saved path on save.
        icon: isCustom || isNone ? undefined : iconChoice,
        showLabel: showLabel || undefined,
      },
      isCustom ? iconFile : null
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIconFile(e.target.files?.[0] || null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Header Link</DialogTitle>
          <DialogDescription>
            Pick an icon, optionally give it a custom label, and paste the URL.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="link-icon">Icon</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center text-muted-foreground">
                {isCustom && iconPreviewUrl ? (
                  <img
                    alt="Icon preview"
                    src={iconPreviewUrl}
                    className="h-10 w-10 object-contain"
                  />
                ) : isNone ? (
                  <LinkIcon size={32} />
                ) : (
                  <PreviewIcon size={32} />
                )}
              </div>
              <Select value={iconChoice} onValueChange={setIconChoice}>
                <SelectTrigger id="link-icon" className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CUSTOM_VALUE}>Upload new</SelectItem>
                  {HEADER_LINK_ICON_CATALOG.map((preset) => {
                    const Icon = preset.Icon;
                    return (
                      <SelectItem key={preset.name} value={preset.name}>
                        <span className="flex items-center gap-2">
                          <Icon size={16} />
                          {preset.title}
                        </span>
                      </SelectItem>
                    );
                  })}
                  <SelectItem value={NONE_VALUE}>
                    <span className="flex items-center gap-2">
                      <LinkIcon width={16} height={16} />
                      Link
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isCustom && (
            <div className="space-y-2">
              <Label htmlFor="link-icon-file">Icon file</Label>
              <input
                ref={iconFileRef}
                id="link-icon-file"
                accept="image/png,image/svg+xml,image/webp,image/jpeg,image/gif,image/x-icon"
                type="file"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <label htmlFor="link-icon-file" className="cursor-pointer">
                    {iconFile ? 'Change…' : 'Upload…'}
                  </label>
                </Button>
                {iconFile && (
                  <span className="max-w-[14rem] truncate text-sm text-muted-foreground">
                    {iconFile.name}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="link-label">Label</Label>
            <Input
              id="link-label"
              placeholder={preset?.title ?? 'Display name (optional)'}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="link-url">URL</Label>
            <Input
              id="link-url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="link-show-label"
              checked={showLabel}
              onCheckedChange={(value) => setShowLabel(value === true)}
            />
            <Label htmlFor="link-show-label" className="cursor-pointer text-sm font-normal">
              Show label next to the icon in the header
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            Add Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
