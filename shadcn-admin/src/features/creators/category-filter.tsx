import { useMemo, useState } from 'react'
import { ChevronRight, Filter, X } from 'lucide-react'
import type { MarketplaceCategory } from '@/lib/api-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

export type CategorySelection = Array<[string, string]>

interface Props {
  options: MarketplaceCategory[] | undefined
  loading?: boolean
  value: CategorySelection
  onChange: (next: CategorySelection) => void
}

export function CategoryFilter({ options, loading, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeParent, setActiveParent] = useState<string | null>(null)

  const parents = options ?? []

  const filteredParents = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return parents
    return parents.filter((p) => p.name.toLowerCase().includes(q))
  }, [parents, search])

  // Map: parentId -> Set<childId selected>
  const selectedByParent = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const [pid, cid] of value) {
      if (!m.has(pid)) m.set(pid, new Set())
      m.get(pid)!.add(cid)
    }
    return m
  }, [value])

  const childrenCountByParent = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of parents) m.set(p.id, p.option_children?.length ?? 0)
    return m
  }, [parents])

  const totalSelected = value.length

  const setParentChildren = (
    parentId: string,
    children: Array<{ id: string }>,
    checked: boolean,
  ) => {
    const next = new Map(selectedByParent)
    if (checked) {
      next.set(parentId, new Set(children.map((c) => c.id)))
    } else {
      next.delete(parentId)
    }
    onChange(flattenSelection(next))
  }

  const toggleChild = (parentId: string, childId: string, checked: boolean) => {
    const next = new Map(selectedByParent)
    const set = new Set(next.get(parentId) ?? [])
    if (checked) set.add(childId)
    else set.delete(childId)
    if (set.size === 0) next.delete(parentId)
    else next.set(parentId, set)
    onChange(flattenSelection(next))
  }

  const clearAll = () => {
    onChange([])
    setActiveParent(null)
  }

  const activeParentObj =
    parents.find((p) => p.id === activeParent) ?? filteredParents[0] ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          className='gap-2'
          disabled={loading || parents.length === 0}
        >
          <Filter className='size-4' />
          Hạng mục sản phẩm
          {totalSelected > 0 && (
            <Badge variant='secondary' className='ml-1'>
              {totalSelected}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className='w-[640px] p-0'
        align='start'
        sideOffset={6}
      >
        <div className='border-b p-2'>
          <Input
            placeholder='Tìm danh mục cha...'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='h-9'
          />
        </div>

        <div className='grid grid-cols-2 divide-x'>
          {/* PARENTS */}
          <ScrollArea className='h-[360px]'>
            <ul className='py-1'>
              {filteredParents.map((p) => {
                const selectedSet = selectedByParent.get(p.id) ?? new Set()
                const total = childrenCountByParent.get(p.id) ?? 0
                const selectedCount = selectedSet.size
                const allSelected =
                  total > 0 && selectedCount === total
                const isActive = activeParentObj?.id === p.id
                return (
                  <li
                    key={p.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent',
                      isActive && 'bg-accent',
                    )}
                    onClick={() => setActiveParent(p.id)}
                  >
                    <Checkbox
                      checked={
                        allSelected
                          ? true
                          : selectedCount > 0
                            ? 'indeterminate'
                            : false
                      }
                      onCheckedChange={(c) =>
                        setParentChildren(
                          p.id,
                          p.option_children ?? [],
                          c === true,
                        )
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className='flex-1 truncate'>
                      {p.name}{' '}
                      <span className='text-muted-foreground'>
                        ({total})
                      </span>
                    </span>
                    <ChevronRight className='size-4 text-muted-foreground' />
                  </li>
                )
              })}
              {filteredParents.length === 0 && (
                <li className='px-3 py-6 text-center text-sm text-muted-foreground'>
                  Không có danh mục
                </li>
              )}
            </ul>
          </ScrollArea>

          {/* CHILDREN of active parent */}
          <ScrollArea className='h-[360px]'>
            <ul className='py-1'>
              {activeParentObj?.option_children?.map((c) => {
                const sel = selectedByParent.get(activeParentObj.id) ?? new Set()
                const checked = sel.has(c.id)
                return (
                  <li
                    key={c.id}
                    className='flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent'
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        toggleChild(activeParentObj.id, c.id, v === true)
                      }
                    />
                    <span className='flex-1 truncate'>{c.name}</span>
                  </li>
                )
              })}
              {(!activeParentObj?.option_children ||
                activeParentObj.option_children.length === 0) && (
                <li className='px-3 py-6 text-center text-sm text-muted-foreground'>
                  Chọn danh mục cha để xem
                </li>
              )}
            </ul>
          </ScrollArea>
        </div>

        <div className='flex items-center justify-between border-t p-2'>
          <span className='text-sm text-muted-foreground'>
            Đã chọn <strong>{totalSelected}</strong> danh mục con
          </span>
          <div className='flex gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={clearAll}
              disabled={totalSelected === 0}
            >
              <X className='mr-1 size-4' />
              Xoá hết
            </Button>
            <Button size='sm' onClick={() => setOpen(false)}>
              Áp dụng
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function flattenSelection(m: Map<string, Set<string>>): CategorySelection {
  const out: CategorySelection = []
  for (const [pid, set] of m) {
    for (const cid of set) out.push([pid, cid])
  }
  return out
}
