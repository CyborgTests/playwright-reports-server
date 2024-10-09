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
  Autocomplete,
  AutocompleteItem,
} from '@nextui-org/react';
import { useState } from 'react';

import { type Result } from '../lib/storage';

import useMutation from '@/app/hooks/useMutation';
import ErrorMessage from '@/app/components/error-message';

interface DeleteProjectButtonProps {
  results: Result[];
  projects: string[];
  onGeneratedReport?: () => void;
}

export default function GenerateReportButton({ results, projects, onGeneratedReport }: DeleteProjectButtonProps) {
  const { mutate: generateReport, isLoading, error } = useMutation('/api/report/generate', { method: 'POST' });

  const [projectName, setProjectName] = useState('');

  const { isOpen, onOpen, onClose, onOpenChange } = useDisclosure();

  const GenerateReport = async () => {
    if (!results?.length) {
      return;
    }

    await generateReport({ resultsIds: results.map((r) => r.resultID), project: projectName });

    setProjectName('');
    onClose();
    onGeneratedReport?.();
  };

  return (
    <>
      {error && <ErrorMessage message={error.message} />}
      <Tooltip color="secondary" content="Generate Report" placement="top">
        <Button color="secondary" isDisabled={!results?.length} isLoading={isLoading} size="md" onClick={onOpen}>
          Generate Report
        </Button>
      </Tooltip>
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">Generate report</ModalHeader>
              <ModalBody>
                <Autocomplete
                  allowsCustomValue
                  defaultInputValue={projects.at(0) ?? ''}
                  items={projects.map((project) => ({ label: project, value: project }))}
                  label="Project name"
                  placeholder="leave empty if not required"
                  onInputChange={(value) => setProjectName(value)}
                  onSelectionChange={(value) => setProjectName(value?.toString() ?? '')}
                >
                  {(item) => <AutocompleteItem key={item.value}>{item.label}</AutocompleteItem>}
                </Autocomplete>
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
