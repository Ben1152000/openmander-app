import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { DistrictStat } from '@/app/constants/metrics';
import { partisanStepColor } from '@/app/constants/colors';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Label } from '@/app/components/ui/label';

function leanLabel(demPct: number): string {
  const margin = Math.abs(demPct * 2 - 100);
  const party = demPct >= 50 ? 'D' : 'R';
  return `${party}+${margin.toFixed(1)}`;
}

type Tooltip = { x: number; y: number; left: boolean; district: number; demPct: number } | null;

type Position = { x: number; y: number; demPct: number; left: boolean };

export function RankVotesChart({ districtStats, activeDistrict, onDistrictSelect }: { districtStats: DistrictStat[]; activeDistrict: number; onDistrictSelect: (district: number) => void }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [positions, setPositions] = useState<Map<number, Position>>(new Map());
  const activeDistrictRef = useRef(activeDistrict);
  useEffect(() => { activeDistrictRef.current = activeDistrict; }, [activeDistrict]);

  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    if (!svgRef.current) return;
    const observer = new ResizeObserver(entries => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || districtStats.length === 0) return;

    const sorted = [...districtStats]
      .filter(d => d.demVotes + d.repVotes > 0)
      .sort((a, b) => {
        const leanA = a.demVotes / (a.demVotes + a.repVotes);
        const leanB = b.demVotes / (b.demVotes + b.repVotes);
        return leanB - leanA;
      });

    if (sorted.length === 0) return;

    const margin = { top: 8, right: 12, bottom: 24, left: 12 };
    const rowHeight = 24;
    const bottomPad = 10;
    const width = svgRef.current.clientWidth;
    const innerHeight = sorted.length * rowHeight + bottomPad;
    const height = innerHeight + margin.top + margin.bottom;

    svgRef.current.setAttribute('height', String(height));

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const innerWidth = width - margin.left - margin.right;

    const x = d3.scaleLinear().domain([0, 1]).range([0, innerWidth]);

    // Competitive range band (45–55%)
    g.append('rect')
      .attr('x', x(0.45)).attr('y', 0)
      .attr('width', x(0.55) - x(0.45)).attr('height', innerHeight)
      .attr('fill', '#fefce8').attr('opacity', 0.8);

    // 50% line
    g.append('line')
      .attr('x1', x(0.5)).attr('x2', x(0.5))
      .attr('y1', 0).attr('y2', innerHeight)
      .attr('stroke', '#aaa').attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3');

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x)
        .tickValues([0, 0.25, 0.5, 0.75, 1])
        .tickFormat(d => `${Math.round((d as number) * 100)}%`))
      .call(ax => ax.select('.domain').remove())
      .call(ax => ax.selectAll('line').attr('stroke', '#ccc'))
      .call(ax => ax.selectAll('text').attr('font-size', 10).attr('fill', 'currentColor'));

    const newPositions = new Map<number, Position>();
    sorted.forEach((d, i) => {
      const total = d.demVotes + d.repVotes;
      const demShare = d.demVotes / total;
      const cy = i * rowHeight + rowHeight / 2;
      const cx = x(demShare);
      newPositions.set(d.district, {
        x: 12 + margin.left + cx,
        y: margin.top + cy,
        demPct: demShare * 100,
        left: demShare < 0.5,
      });

      if (showLabels) {
        const labelColor = demShare >= 0.5 ? '#4040cc' : '#cc4040';

        // District number overlaid at left edge
        g.append('text')
          .attr('x', -6).attr('y', cy)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'start').attr('font-size', 10)
          .attr('font-weight', 'bold')
          .attr('fill', 'currentColor')
          .attr('pointer-events', 'none')
          .text(String(d.district));

        // Partisan lean next to the dot
        const flipLeft = (demShare > 0.25 && demShare < 0.5) || demShare > 0.75;
        g.append('text')
          .attr('x', flipLeft ? cx - 10 : cx + 10).attr('y', cy)
          .attr('dy', '0.35em')
          .attr('text-anchor', flipLeft ? 'end' : 'start').attr('font-size', 10)
          .attr('fill', labelColor)
          .attr('pointer-events', 'none')
          .text(leanLabel(demShare * 100));
      }

      g.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', 6)
        .attr('fill', partisanStepColor(demShare * 2 - 1))
        .attr('stroke', '#fff').attr('stroke-width', 1.5)
        .attr('pointer-events', 'none');

      // Invisible larger hit area
      g.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', 14)
        .attr('fill', 'transparent')
        .attr('cursor', 'pointer')
        .on('click', () => { onDistrictSelect(activeDistrictRef.current === d.district ? 0 : d.district); setTooltip(null); })
        .on('mouseover', () => {
          if (d.district === activeDistrictRef.current) return;
          setTooltip({
            x: 12 + margin.left + cx,
            y: margin.top + cy,
            left: demShare < 0.5,
            district: d.district,
            demPct: demShare * 100,
          });
        })
        .on('mouseout', () => setTooltip(null));
    });

    setPositions(newPositions);
  }, [districtStats, showLabels, containerWidth]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Rank-Votes Chart</h3>
        <div className="flex items-center gap-2">
          <Checkbox
            id="rank-votes-labels"
            checked={showLabels}
            onCheckedChange={v => setShowLabels(v === true)}
          />
          <Label htmlFor="rank-votes-labels" className="text-sm font-medium cursor-pointer">Labels</Label>
        </div>
      </div>
      <div className="relative w-full border rounded-lg px-3 py-1 bg-background" style={{ overflow: 'visible' }}>
      <svg ref={svgRef} className="w-full" style={{ display: 'block' }} />
      {activeDistrict > 0 && positions.has(activeDistrict) && (() => {
        const p = positions.get(activeDistrict)!;
        return (
          <div
            className="absolute pointer-events-none bg-popover text-popover-foreground border rounded shadow-md px-2 py-1 text-xs whitespace-nowrap"
            style={p.left
              ? { left: p.x + 14, top: p.y, transform: 'translateY(-50%)' }
              : { left: p.x - 14, top: p.y, transform: 'translate(-100%, -50%)' }}
          >
            <div className="font-medium">District {activeDistrict}</div>
            <div style={{ color: p.demPct >= 50 ? '#4040cc' : '#cc4040' }}>{leanLabel(p.demPct)}</div>
          </div>
        );
      })()}
      {tooltip && !showLabels && (
        <div
          className="absolute pointer-events-none bg-popover text-popover-foreground border rounded shadow-md px-2 py-1 text-xs whitespace-nowrap"
          style={tooltip.left
            ? { left: tooltip.x + 14, top: tooltip.y, transform: 'translateY(-50%)' }
            : { left: tooltip.x - 14, top: tooltip.y, transform: 'translate(-100%, -50%)' }}
        >
          <div className="font-medium">District {tooltip.district}</div>
          <div style={{ color: tooltip.demPct >= 50 ? '#4040cc' : '#cc4040' }}>
            {leanLabel(tooltip.demPct)}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
