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
  resultIds: string[];
  onDeletedResult?: () => void;
}

export default function DeleteResultsButton({ resultIds, onDeletedResult }: Readonly<DeleteProjectButtonProps>) {
  const queryClient = useQueryClient();
  const {
    mutate: deleteResult,
    isPending,
    error,
  } = useMutation('/api/result/delete', {
    method: 'DELETE',
    onSuccess: () => {
      invalidateCache(queryClient, { queryKeys: ['/api/info'], predicate: '/api/result' });
      toast.success(`result${resultIds.length ? '' : 's'} ${resultIds ?? 'are'} deleted`);
    },
  });
  const [confirm, setConfirm] = useState('');

  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  const DeleteResult = async () => {
    if (!resultIds?.length) {
      return;
    }

    deleteResult({ body: { resultsIds: resultIds } });

    onDeletedResult?.();
  };

  error && toast.error(error.message);

  return (
    <>
      <Tooltip color="danger" content="Delete Result" placement="top">
        <Button color="danger" isDisabled={!resultIds?.length} isLoading={isPending} size="md" onPress={onOpen}>
          <DeleteIcon />
        </Button>
      </Tooltip>
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">Are you absolutely sure?</ModalHeader>
              <ModalBody>
                <p>This action cannot be undone. This will permanently delete your results files.</p>
                <p>
                  Please type {resultIds?.length > 1 ? 'first' : ''} result id&nbsp;
                  <strong className="break-all">&quot;{resultIds?.at(0)}&quot;</strong>
                  &nbsp;to confirm:
                </p>
                <Input isRequired label="Confirm" value={confirm} onValueChange={setConfirm} />
              </ModalBody>
              <ModalFooter>
                <Button
                  color="primary"
                  variant="light"
                  onPress={() => {
                    setConfirm('');
                    onClose();
                  }}
                >
                  Close
                </Button>
                <Button
                  color="danger"
                  isDisabled={confirm !== resultIds?.at(0)}
                  isLoading={isPending}
                  onClick={() => {
                    DeleteResult();
                    setConfirm('');
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
