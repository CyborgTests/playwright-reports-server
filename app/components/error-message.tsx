import React from 'react';

interface Props {
  readonly message?: string;
}

const ErrorMessage: React.FC<Props> = ({ message }) =>
  message ? (
    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
      <strong className="font-bold">Error:</strong>
      <span className="block sm:inline">{message}</span>
    </div>
  ) : null;

export default ErrorMessage;
