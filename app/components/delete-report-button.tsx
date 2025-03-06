'use client';

import {
  Input,
  Tooltip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure,
  Button,
} from "@heroui/react";
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import useMutation from '@/app/hooks/useMutation';
import { DeleteIcon } from '@/app/components/icons';
import { invalidateCache } from '@/app/lib/query-cache';

interface DeleteProjectButtonProps {
  reportId: string;
  onDeleted: () => void;
}

export default function DeleteReportButton({ reportId, onDeleted }: DeleteProjectButtonProps) {
  const queryClient = useQueryClient();
  const {
    mutate: deleteReport,
    isPending,
    error,
  } = useMutation('/api/report/delete', {
    method: 'DELETE',
    onSuccess: () => {
      invalidateCache(queryClient, { queryKeys: ['/api/info'], predicate: '/api/report' });
      toast.success(`report "${reportId}" deleted`);
    },
  });
  const [confirm, setConfirm] = useState('');

  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  const DeleteReport = async () => {
    if (!reportId) {
      return;
    }

    deleteReport({ body: { reportsIds: [reportId] } });

    onDeleted?.();
  };

  error && toast.error(error.message);

  return (
    !!reportId && (
      <>
        <Tooltip color="danger" content="Delete Report" placement="top">
          <Button color="danger" isLoading={isPending} size="md" onPress={onOpen}>
            <DeleteIcon />
          </Button>
        </Tooltip>
        <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">Are you absolutely sure?</ModalHeader>
                <ModalBody>
                  <p>This action cannot be undone. This will permanently delete your report.</p>
                  <p>
                    Please type report id&nbsp;
                    <strong className="break-all">&quot;{reportId}&quot;</strong>
                    &nbsp;to confirm:
                  </p>
                  <Input isRequired label="Confirm" value={confirm} onValueChange={setConfirm} />
                </ModalBody>
                <ModalFooter>
                  <Button color="primary" variant="light" onPress={onClose}>
                    Close
                  </Button>
                  <Button
                    color="danger"
                    isDisabled={confirm !== reportId}
                    isLoading={isPending}
                    onClick={() => {
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
    )
  );
}
