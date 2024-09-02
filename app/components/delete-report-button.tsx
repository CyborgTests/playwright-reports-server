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
  reportId?: string;
  token: string;
}

export default function DeleteReportButton({ reportId, token }: DeleteProjectButtonProps) {
  const router = useRouter();
  const [confirm, setConfirm] = useState('');

  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  const DeleteReport = async () => {
    if (!reportId) {
      return;
    }

    const headers = !!token
      ? {
          Authorization: token,
        }
      : undefined;

    await fetch('/api/report/delete', {
      method: 'DELETE',
      body: JSON.stringify({ reportsIds: [reportId] }),
      headers,
    });

    router.refresh();
  };

  return (
    !!reportId && (
      <>
        <Tooltip color="danger" content="Delete Report" placement="top">
          <Button color="danger" size="md" onPress={onOpen}>
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
                  <Button color="danger" isDisabled={confirm !== reportId} onClick={DeleteReport} onPress={onClose}>
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
