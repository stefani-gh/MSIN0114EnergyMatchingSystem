import type { MatchingCustomerAllocation } from './matchingTypes'

export const customerRegistryStorageKey = 'energy-matching-customers'
export const generatorRegistryStorageKey = 'energy-matching-generators'

export function readCustomerAllocationsFromStorage() {
  try {
    const storedCustomers = window.localStorage.getItem(customerRegistryStorageKey)

    if (!storedCustomers) {
      return []
    }

    const parsedCustomers: unknown = JSON.parse(storedCustomers)

    if (!Array.isArray(parsedCustomers)) {
      return []
    }

    return parsedCustomers.flatMap<MatchingCustomerAllocation>((customer) => {
      if (!isStoredCustomerWithAllocation(customer)) {
        return []
      }

      return [
        {
          siteId: customer.siteId,
          mpan: customer.mpan,
          customerName: customer.name,
          contractId: customer.contractId,
          sharePercentage: customer.contractedSharePercentage,
        },
      ]
    })
  } catch {
    return []
  }
}

function isStoredCustomerWithAllocation(
  value: unknown,
): value is {
  name: string
  contractId?: string
  siteId: string
  mpan: string
  contractedSharePercentage: number
} {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { name?: unknown }).name === 'string' &&
    (typeof (value as { contractId?: unknown }).contractId === 'undefined' ||
      typeof (value as { contractId?: unknown }).contractId === 'string') &&
    typeof (value as { siteId?: unknown }).siteId === 'string' &&
    typeof (value as { mpan?: unknown }).mpan === 'string' &&
    typeof (value as { contractedSharePercentage?: unknown })
      .contractedSharePercentage === 'number' &&
    Number.isFinite(
      (value as { contractedSharePercentage: number })
        .contractedSharePercentage,
    )
  )
}
