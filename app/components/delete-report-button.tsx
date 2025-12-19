'use client';

import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, useDisclosure, Button } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import useMutation from '@/app/hooks/useMutation';
import { DeleteIcon } from '@/app/components/icons';
import { invalidateCache } from '@/app/lib/query-cache';

interface DeleteProjectButtonProps {
  reportId?: string;
  reportIds?: string[];
  onDeleted: () => void;
  label?: string;
}

export default function DeleteReportButton({ reportId, reportIds, onDeleted, label }: DeleteProjectButtonProps) {
  const queryClient = useQueryClient();
  const ids = reportIds ?? (reportId ? [reportId] : []);

  const {
    mutate: deleteReport,
    isPending,
    error,
  } = useMutation('/api/report/delete', {
    method: 'DELETE',
    onSuccess: () => {
      invalidateCache(queryClient, { queryKeys: ['/api/info'], predicate: '/api/report' });
      toast.success(`report${ids.length > 1 ? 's' : ''} deleted`);
    },
  });

  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  const DeleteReport = async () => {
    if (!ids.length) {
      return;
    }

    deleteReport({ body: { reportsIds: ids } });

    onDeleted?.();
  };

  error && toast.error(error.message);

  return (
    <>
      <Button
        className={`${!label ? 'p-0 min-w-10' : ''}`}
        color="primary"
        isDisabled={!ids.length}
        isLoading={isPending}
        size="md"
        title="Delete report"
        variant="solid"
        onPress={onOpen}
      >
        {label || <DeleteIcon size={24} />}
      </Button>
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">Are you sure?</ModalHeader>
              <ModalBody>
                <p>This will permanently delete your report{ids.length > 1 ? 's' : ''}.</p>
              </ModalBody>
              <ModalFooter>
                <Button color="primary" variant="light" onPress={onClose}>
                  Close
                </Button>
                <Button
                  color="danger"
                  isLoading={isPending}
                  onPress={() => {
                    DeleteReport();
                    onClose();
                  }}
                >
                  Sure, Delete
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
