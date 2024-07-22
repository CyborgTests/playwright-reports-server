export const isAuthorized = ({
  actualAuthToken,
  expectedAuthToken,
}: {
  actualAuthToken: string | null;
  expectedAuthToken: string;
}) => actualAuthToken === expectedAuthToken;
