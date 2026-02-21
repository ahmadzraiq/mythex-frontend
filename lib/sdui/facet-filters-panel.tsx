'use client';

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface FacetValueItem {
  count: number;
  facetValue: {
    id: string;
    name: string;
    facet: { id: string; name: string };
  };
}

interface FacetGroup {
  id: string;
  name: string;
  values: { id: string; name: string; count: number }[];
}

interface FacetFiltersPanelProps {
  facetValues?: FacetValueItem[];
  selectedFacets?: string[];
  className?: string;
}

export function FacetFiltersPanel({
  facetValues = [],
  selectedFacets = [],
  className,
}: FacetFiltersPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Group flat facetValues by facet.name
  const facetGroups = facetValues.reduce((acc, item) => {
    const key = item.facetValue.facet.name;
    if (!acc[key]) {
      acc[key] = {
        id: item.facetValue.facet.id,
        name: key,
        values: [],
      };
    }
    acc[key].values.push({
      id: item.facetValue.id,
      name: item.facetValue.name,
      count: item.count,
    });
    return acc;
  }, {} as Record<string, FacetGroup>);

  const groups = Object.values(facetGroups);
  if (groups.length === 0) return null;

  const toggleFacet = (id: string) => {
    const params = new URLSearchParams(searchParams ?? undefined);
    const current = params.getAll('facets');

    if (current.includes(id)) {
      params.delete('facets');
      current.filter((x) => x !== id).forEach((x) => params.append('facets', x));
    } else {
      params.append('facets', id);
    }
    params.delete('page');
    router.push(`${pathname ?? ''}?${params.toString()}`);
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams ?? undefined);
    params.delete('facets');
    params.delete('page');
    router.push(`${pathname ?? ''}?${params.toString()}`);
  };

  const hasActive = Array.isArray(selectedFacets) && selectedFacets.length > 0;

  return (
    <div className={`space-y-6 ${className ?? ''}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg text-gray-900 dark:text-gray-100">Filters</h2>
        {hasActive && (
          <button
            onClick={clearFilters}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {groups.map((facet) => (
        <div key={facet.id} className="space-y-3">
          <h3 className="font-medium text-sm text-gray-700 dark:text-gray-300 capitalize">
            {facet.name}
          </h3>
          <div className="space-y-2">
            {facet.values.map((value) => {
              const isChecked =
                Array.isArray(selectedFacets) && selectedFacets.includes(value.id);
              return (
                <div
                  key={value.id}
                  className="flex items-center gap-2 cursor-pointer group"
                  onClick={() => toggleFacet(value.id)}
                >
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                      isChecked
                        ? 'bg-gray-900 border-gray-900 dark:bg-white dark:border-white'
                        : 'border-gray-300 dark:border-gray-600 group-hover:border-gray-500'
                    }`}
                  >
                    {isChecked && (
                      <svg
                        className="w-2.5 h-2.5 text-white dark:text-gray-900"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors">
                    {value.name}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    ({value.count})
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
