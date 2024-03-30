import Image from 'next/image';
import { formatDateToLocal, formatCurrency, formatTimeToLocal } from '@/app/lib/utils';
import { readReports, readResults } from '@/app/lib/data';
import { SeeReport } from '../invoices/buttons';

export default async function ReportsTable({
  query,
  currentPage,
}: {
  query: string;
  currentPage: number;
}) {
  const results = await readReports(query);

  return (
    <div className="mt-6 flow-root">
      <div className="inline-block min-w-full align-middle">
        <div className="rounded-lg bg-gray-50 p-2 md:pt-0">
          <div className="md:hidden">
            {results?.map((result) => (
              <div
                key={result.reportID}
                className="mb-2 w-full rounded-md bg-white p-4"
              >
                <div className="flex items-center justify-between border-b pb-4">
                  <div>
                    <div className="mb-2 flex items-center">
                      {/* <Image
                        src={invoice.image_url}
                        className="mr-2 rounded-full"
                        width={28}
                        height={28}
                        alt={`${invoice.name}'s profile picture`}
                      /> */}
                      <p>{result.reportID}</p>
                    </div>
                    {/* <p className="text-sm text-gray-500">{result.email}</p> */}
                  </div>
                  {/* <InvoiceStatus status={invoice.status} /> */}
                </div>
                <div className="flex w-full items-center justify-between pt-4">
                  <div>
                    {/* <p className="text-xl font-medium">
                      {formatCurrency(result.amount)}
                    </p> */}
                    <p>{formatDateToLocal(result.createdAt.toISOString())}</p>
                  </div>
                  {/* <div className="flex justify-end gap-2">
                    <UpdateInvoice id={invoice.id} />
                    <DeleteInvoice id={invoice.id} />
                  </div> */}
                </div>
              </div>
            ))}
          </div>
          <table className="hidden min-w-full text-gray-900 md:table">
            <thead className="rounded-lg text-left text-sm font-normal">
              <tr>
                <th scope="col" className="px-4 py-5 font-medium sm:pl-6">
                  Report Id
                </th>
                <th scope="col" className="px-3 py-5 font-medium">
                  {/* Email */}
                </th>
                <th scope="col" className="px-3 py-5 font-medium">
                  {/* Amount */}
                </th>
                <th scope="col" className="px-3 py-5 font-medium">
                  Date
                </th>
                <th scope="col" className="px-3 py-5 font-medium">
                  {/* Status */}
                </th>
                <th scope="col" className="relative py-3 pl-6 pr-3">
                  {/* <span className="sr-only">Edit</span> */}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {results?.map((result) => (
                <tr
                  key={result.reportID}
                  className="w-full border-b py-3 text-sm last-of-type:border-none [&:first-child>td:first-child]:rounded-tl-lg [&:first-child>td:last-child]:rounded-tr-lg [&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg"
                >
                  <td className="whitespace-nowrap py-3 pl-6 pr-3">
                    <div className="flex items-center gap-3">
                      {/* <Image
                        src={result.image_url}
                        className="rounded-full"
                        width={28}
                        height={28}
                        alt={`${result.name}'s profile picture`}
                      /> */}
                      <p>{result.reportID}</p>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {/* {result.email} */}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {/* {formatCurrency(result.amount)} */}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {formatDateToLocal(result.createdAt.toISOString())} {formatTimeToLocal(result.createdAt.toISOString())} 
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {/* <InvoiceStatus status={result.status} /> */}
                  </td>
                  <td className="whitespace-nowrap py-3 pl-6 pr-3">
                    <div className="flex justify-end gap-3">
                      {<SeeReport id={result.reportID} />
                      /* <DeleteInvoice id={result.id} /> */}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
