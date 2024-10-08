'use client';

import {
  Tooltip,
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  useDisclosure,
  ModalFooter,
  Input,
} from '@nextui-org/react';
import { useState } from 'react';

import useMutation from '@/app/hooks/useMutation';
import ErrorMessage from '@/app/components/error-message';

interface DeleteProjectButtonProps {
  resultIds?: string[];
  onGeneratedReport?: () => void;
}

export default function GenerateReportButton({ resultIds, onGeneratedReport }: DeleteProjectButtonProps) {
  const { mutate: generateReport, isLoading, error } = useMutation('/api/report/generate', { method: 'POST' });

  const [projectName, setProjectName] = useState('');

  const { isOpen, onOpen, onClose, onOpenChange } = useDisclosure();

  const GenerateReport = async () => {
    if (!resultIds?.length) {
      return;
    }

    await generateReport({ resultsIds: resultIds, project: projectName });

    setProjectName('');
    onClose();
    onGeneratedReport?.();
  };

  return (
    <>
      {error && <ErrorMessage message={error.message} />}
      <Tooltip color="secondary" content="Generate Report" placement="top">
        <Button color="secondary" isDisabled={!resultIds?.length} isLoading={isLoading} size="md" onClick={onOpen}>
          Generate Report
        </Button>
      </Tooltip>
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">Generate report</ModalHeader>
              <ModalBody>
                <Input
                  isDisabled={isLoading}
                  label="Project"
                  placeholder="project name, could be empty"
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </ModalBody>
              <ModalFooter>
                <Button color="danger" isDisabled={isLoading} onClick={onClose}>
                  Close
                </Button>
                <Button color="success" isLoading={isLoading} type="submit" onClick={GenerateReport}>
                  Generate
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
