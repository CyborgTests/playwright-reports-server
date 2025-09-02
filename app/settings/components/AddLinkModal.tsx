'use client';

import { Input, Button } from '@heroui/react';

interface AddLinkModalProps {
  isOpen: boolean;
  newLinkData: { name: string; url: string };
  onAddLink: () => void;
  onCancel: () => void;
  onUpdateLinkData: (data: { name: string; url: string }) => void;
}

export default function AddLinkModal({
  isOpen,
  newLinkData,
  onAddLink,
  onCancel,
  onUpdateLinkData,
}: AddLinkModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
        <h3 className="text-lg font-semibold mb-4">Add Header Link</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="link-name">
              Link Name
            </label>
            <Input
              id="link-name"
              placeholder="e.g., github, telegram, discord"
              value={newLinkData.name}
              onChange={(e) => onUpdateLinkData({ ...newLinkData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="link-url">
              URL
            </label>
            <Input
              id="link-url"
              placeholder="https://example.com"
              value={newLinkData.url}
              onChange={(e) => onUpdateLinkData({ ...newLinkData, url: e.target.value })}
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <Button color="default" onPress={onCancel}>
            Cancel
          </Button>
          <Button color="primary" isDisabled={!newLinkData.name || !newLinkData.url} onPress={onAddLink}>
            Add Link
          </Button>
        </div>
      </div>
    </div>
  );
}
