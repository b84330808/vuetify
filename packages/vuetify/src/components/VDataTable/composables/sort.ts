// Composables
import { useLocale } from '@/composables/locale'
import { useProxiedModel } from '@/composables/proxiedModel'

// Utilities
import { computed, inject, provide, toRef } from 'vue'
import { getObjectValueByPath, isEmpty, isNullOrUndefined, isObject, propsFactory } from '@/util'

// Types
import type { InjectionKey, PropType, Ref } from 'vue'
import type { DataTableCompareFunction, InternalDataTableHeader } from '../types'
import type { InternalItem } from '@/composables/filter'

export const makeDataTableSortProps = propsFactory({
  initialSortOrder: {
    type: String as PropType<'asc' | 'desc'>,
    default: 'asc',
    validator: (v: any) => !v || ['asc', 'desc'].includes(v),
  },
  sortBy: {
    type: Array as PropType<readonly SortItem[]>,
    default: () => ([]),
  },
  customKeySort: Object as PropType<Record<string, DataTableCompareFunction>>,
  multiSort: {
    type: [Boolean, Object] as PropType<boolean | MultiSortProps>,
    default: false,
  },
  mustSort: Boolean,
}, 'DataTable-sort')

const VDataTableSortSymbol: InjectionKey<{
  sortBy: Ref<readonly SortItem[]>
  toggleSort: (column: InternalDataTableHeader, event?: KeyboardEvent | PointerEvent, mandatory?: boolean) => void
  isSorted: (column: InternalDataTableHeader) => boolean
}> = Symbol.for('vuetify:data-table-sort')

export type SortItem = { key: string, order?: boolean | 'asc' | 'desc' }
export type MultiSortProps = {
  key?: 'ctrl'
  mode?: MultiSortMode
  modifier?: 'alt' | 'shift'
}

export type MultiSortMode = 'append' | 'prepend'

type SortProps = {
  initialSortOrder: 'asc' | 'desc'
  sortBy: readonly SortItem[]
  'onUpdate:sortBy': ((value: any) => void) | undefined
  multiSort: boolean | MultiSortProps
  mustSort: boolean
}

export function createSort (props: SortProps) {
  const initialSortOrder = toRef(() => props.initialSortOrder)
  const sortBy = useProxiedModel(props, 'sortBy')
  const mustSort = toRef(() => props.mustSort)
  const multiSort = toRef(() => props.multiSort)
  return { initialSortOrder, sortBy, multiSort, mustSort }
}

function resolveMultiSort (
  multiSort: boolean | MultiSortProps,
  event?: KeyboardEvent | PointerEvent
): {
  active: boolean
  mode?: MultiSortMode
} {
  if (!isObject(multiSort)) {
    return { active: !!multiSort }
  }

  const { key, mode, modifier } = multiSort
  const reverseMode = (modifier === 'alt' && event?.altKey) ||
    (modifier === 'shift' && event?.shiftKey)

  return {
    active: !key || event?.ctrlKey || event?.metaKey || false,
    mode: reverseMode ? (mode === 'append' ? 'prepend' : 'append') : mode,
  }
}

export function provideSort (options: {
  initialSortOrder: Ref<'asc' | 'desc'>
  sortBy: Ref<readonly SortItem[]>
  multiSort: Ref<boolean | MultiSortProps>
  mustSort: Ref<boolean>
  page?: Ref<number>
}) {
  const { initialSortOrder, sortBy, mustSort, multiSort, page } = options

  const toggleSort = (column: InternalDataTableHeader, event?: KeyboardEvent | PointerEvent, mandatory = false) => {
    if (column.key == null) return

    let newSortBy = sortBy.value.map(x => ({ ...x })) ?? []
    const item = newSortBy.find(x => x.key === column.key)

    const initialOrder = initialSortOrder.value
    const secondaryOrder = initialSortOrder.value === 'desc' ? 'asc' : 'desc'
    if (!item) {
      const { active, mode } = resolveMultiSort(multiSort.value, event)
      if (active) {
        if (mode === 'prepend') {
          newSortBy.unshift({ key: column.key, order: initialOrder })
        } else {
          newSortBy.push({ key: column.key, order: initialOrder })
        }
      } else {
        newSortBy = [{ key: column.key, order: initialOrder }]
      }
    } else if (item.order === secondaryOrder) {
      if (mandatory || (mustSort.value && newSortBy.length === 1)) {
        item.order = initialSortOrder.value
      } else {
        newSortBy = newSortBy.filter(x => x.key !== column.key)
      }
    } else {
      item.order = secondaryOrder
    }

    sortBy.value = newSortBy
    if (page) page.value = 1
  }

  function isSorted (column: InternalDataTableHeader) {
    return !!sortBy.value.find(item => item.key === column.key)
  }

  const data = { sortBy, toggleSort, isSorted }

  provide(VDataTableSortSymbol, data)

  return data
}

export function useSort () {
  const data = inject(VDataTableSortSymbol)

  if (!data) throw new Error('Missing sort!')

  return data
}

// TODO: abstract into project composable
export function useSortedItems<T extends InternalItem> (
  props: {
    customKeySort: Record<string, DataTableCompareFunction> | undefined
  },
  items: Ref<T[]>,
  sortBy: Ref<readonly SortItem[]>,
  options?: {
    transform?: (item: T) => {}
    sortFunctions?: Ref<Record<string, DataTableCompareFunction> | undefined>
    sortRawFunctions?: Ref<Record<string, DataTableCompareFunction> | undefined>
  },
) {
  const locale = useLocale()
  const sortedItems = computed(() => {
    if (!sortBy.value.length) return items.value

    return sortItems(items.value, sortBy.value, locale.current.value, {
      transform: options?.transform,
      sortFunctions: {
        ...props.customKeySort,
        ...options?.sortFunctions?.value,
      },
      sortRawFunctions: options?.sortRawFunctions?.value,
    })
  })

  return { sortedItems }
}

export function sortItems<T extends InternalItem> (
  items: T[],
  sortByItems: readonly SortItem[],
  locale: string,
  options?: {
    transform?: (item: T) => Record<string, any>
    sortFunctions?: Record<string, DataTableCompareFunction>
    sortRawFunctions?: Record<string, DataTableCompareFunction>
  },
): T[] {
  const stringCollator = new Intl.Collator(locale, { sensitivity: 'accent', usage: 'sort' })

  const transformedItems = items.map(item => {
    const transformed = options?.transform ? options.transform(item) : item as never
    const values = sortByItems.map(({ key }) => getObjectValueByPath(transformed, key))

    return { item, values, sortValues: values.map(toSortValue) }
  })

  return transformedItems.sort((a, b) => {
    for (let i = 0; i < sortByItems.length; i++) {
      let hasCustomResult = false
      const sortKey = sortByItems[i].key
      const sortOrder = sortByItems[i].order ?? 'asc'

      if (sortOrder === false) continue

      const first = sortOrder === 'desc' ? b : a
      const second = sortOrder === 'desc' ? a : b

      if (options?.sortRawFunctions?.[sortKey]) {
        const customResult = options.sortRawFunctions[sortKey](first.item.raw, second.item.raw)

        if (customResult == null) continue
        hasCustomResult = true
        if (customResult) return customResult
      }

      if (options?.sortFunctions?.[sortKey]) {
        const customResult = options.sortFunctions[sortKey](first.values[i], second.values[i])

        if (customResult == null) continue
        hasCustomResult = true
        if (customResult) return customResult
      }

      if (hasCustomResult) continue

      let sortA = first.sortValues[i]
      let sortB = second.sortValues[i]

      // Dates should be compared numerically
      if (sortA.time && sortB.time) {
        sortA = sortA.time
        sortB = sortB.time
      }

      if (sortA.text !== sortB.text) {
        if (sortA.empty && sortB.empty) return 0
        if (sortA.empty) return -1
        if (sortB.empty) return 1
        if (!isNaN(sortA.number) && !isNaN(sortB.number)) return sortA.number - sortB.number
        return stringCollator.compare(sortA.text, sortB.text)
      }
    }

    return 0
  }).map(({ item }) => item)
}

type SortValue = {
  text: any
  empty: boolean
  number: number
  time?: SortValue
}

function toSortValue (value: any): SortValue {
  const text = isNullOrUndefined(value) ? value : value.toString().toLocaleLowerCase()

  return {
    text,
    empty: isEmpty(text),
    number: Number(text),
    time: value instanceof Date ? toSortValue(value.getTime()) : undefined,
  }
}
