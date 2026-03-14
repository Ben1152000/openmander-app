import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { DistrictStat } from '@/app/constants/metrics';

const leanColor = d3.scaleLinear<string>()
  .domain([0, 0.25, 0.5, 0.75, 1])
  .range(['#990000', '#ff4040', '#e8e8e8', '#4040ff', '#000099'])
  .interpolate(d3.interpolateRgb as any);

type Tooltip = { x: number; y: number; left: boolean; district: number; demPct: number } | null;

export function RankVotesChart({ districtStats }: { districtStats: DistrictStat[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip>(null);

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

    sorted.forEach((d, i) => {
      const total = d.demVotes + d.repVotes;
      const demShare = d.demVotes / total;
      const cy = i * rowHeight + rowHeight / 2;
      const cx = x(demShare);

      g.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', 6)
        .attr('fill', leanColor(demShare))
        .attr('stroke', '#fff').attr('stroke-width', 1.5)
        .attr('pointer-events', 'none');

      // Invisible larger hit area
      g.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', 14)
        .attr('fill', 'transparent')
        .attr('cursor', 'pointer')
        .on('mouseover', () => {
          setTooltip({
            x: margin.left + cx,
            y: margin.top + cy,
            left: demShare < 0.5,
            district: d.district,
            demPct: demShare * 100,
          });
        })
        .on('mouseout', () => setTooltip(null));

    });

  }, [districtStats]);

  return (
    <div className="relative w-full" style={{ overflow: 'visible' }}>
      <svg ref={svgRef} className="w-full" style={{ display: 'block' }} />
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-popover text-popover-foreground border rounded shadow-md px-2 py-1 text-xs whitespace-nowrap"
          style={tooltip.left
            ? { left: tooltip.x + 14, top: tooltip.y, transform: 'translateY(-50%)' }
            : { left: tooltip.x - 14, top: tooltip.y, transform: 'translate(-100%, -50%)' }}
        >
          <div className="font-medium">District {tooltip.district}</div>
          <div style={{ color: tooltip.demPct >= 50 ? '#4040cc' : '#cc4040' }}>
            {(() => { const margin = Math.abs(tooltip.demPct * 2 - 100); const party = tooltip.demPct >= 50 ? 'D' : 'R'; return `${party}+${margin.toFixed(1)}`; })()}
          </div>
        </div>
      )}
    </div>
  );
}
