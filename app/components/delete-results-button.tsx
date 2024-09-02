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
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { DeleteIcon } from '@/app/components/icons';

interface DeleteProjectButtonProps {
  resultIds: string[];
  token: string;
}

export default function DeleteResultsButton({ resultIds, token }: DeleteProjectButtonProps) {
  const router = useRouter();
  const [confirm, setConfirm] = useState('');

  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  const DeleteResult = async () => {
    if (!resultIds?.length) {
      return;
    }

    const headers = !!token
      ? {
          Authorization: token,
        }
      : undefined;

    await fetch('/api/result/delete', {
      method: 'DELETE',
      body: JSON.stringify({ resultsIds: resultIds }),
      headers,
    });

    router.refresh();
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
                <Button color="primary" variant="light" onPress={onClose}>
                  Close
                </Button>
                <Button
                  color="danger"
                  isDisabled={confirm !== resultIds?.at(0)}
                  onClick={DeleteResult}
                  onPress={onClose}
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
