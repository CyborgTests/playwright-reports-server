

export function RenderTime() {
  return (
    <div className="flex items-center pb-2 pt-6">
    {/* <ArrowPathIcon className="h-5 w-5 text-gray-500" /> */}
    <h3 className="ml-2 text-sm text-gray-500 ">
      {new Date().toLocaleDateString()}{' '}
      {new Date().toLocaleTimeString()}
    </h3>
  </div>
  );
}
