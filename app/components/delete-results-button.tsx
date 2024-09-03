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
} from '@nextui-org/react';
import { useState } from 'react';

import useMutation from '@/app/hooks/useMutation';
import ErrorMessage from '@/app/components/error-message';
import { DeleteIcon } from '@/app/components/icons';

interface DeleteProjectButtonProps {
  resultIds: string[];
  onDeletedResult?: () => void;
}

export default function DeleteResultsButton({ resultIds, onDeletedResult }: DeleteProjectButtonProps) {
  const { mutate: deleteResult, isLoading, error } = useMutation('/api/result/delete', { method: 'DELETE' });
  const [confirm, setConfirm] = useState('');

  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  const DeleteResult = async () => {
    if (!resultIds?.length) {
      return;
    }

    await deleteResult({ resultsIds: resultIds });

    onDeletedResult?.();
  };

  return (
    <>
      <Tooltip color="danger" content="Delete Result" placement="top">
        <Button color="danger" isDisabled={!resultIds?.length} size="md" onPress={onOpen}>
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
                {error && <ErrorMessage message={error.message} />}
                <Button color="primary" variant="light" onPress={onClose}>
                  Close
                </Button>
                <Button
                  color="danger"
                  isDisabled={confirm !== resultIds?.at(0)}
                  isLoading={isLoading}
                  onClick={DeleteResult}
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
