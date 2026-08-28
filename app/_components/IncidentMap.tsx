'use client';

/**
 * IncidentMap — live map prototype for the operations screen (C7, see
 * docs/product idea doc §4.1 "الخريطة الحية"). Renders the incident's
 * fused location (with its uncertainty radius as a circle — same value
 * src/lib/confidence.ts already computes), every raw location observation
 * that fed the fusion, the recommended/assigned unit's last known position
 * (from UnitLocation, real seeded data — not invented), and the
 * recommended/assigned entrance. This is intentionally a READ-ONLY picture
 * of data the API already returns; it adds no new state and no new write
 * path, same "explain, don't decide" posture as the AI advisory layer
 * described in the idea doc's §3.4.
 *
 * Built with the raw `leaflet` package (not react-leaflet) to keep the
 * dependency surface small and avoid a peer-dependency version chase under
 * hackathon time pressure. Loaded via next/dynamic with ssr:false from
 * operations/page.tsx, since Leaflet touches `window`/`document` and this
 * app has no other client-only-widget precedent to follow.
 *
 * Tiles: OpenStreetMap's public tile server — free, no API key, suitable
 * for a demo. A production deployment should point at a paid/rate-limited
 * tile provider per OSM's tile usage policy; see the idea doc's data-
 * governance section for why this stays desk/demo-scale only for now.
 */
import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';

export interface MapObservation {
  id: string;
  latitude: number;
  longitude: number;
  provenanceLabel: string;
  conflicting?: boolean;
}

export interface MapPoint {
  latitude: number;
  longitude: number;
  label: string;
}

interface IncidentMapProps {
  incident: { latitude: number; longitude: number; uncertaintyRadiusMeters?: number | null; rescueCode: string };
  observations?: MapObservation[];
  unit?: MapPoint | null;
  alternativeUnit?: MapPoint | null;
  entrance?: MapPoint | null;
}

const RIYADH_FALLBACK: [number, number] = [24.7136, 46.6753];

export default function IncidentMap({ incident, observations = [], unit, alternativeUnit, entrance }: IncidentMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    let cancelled = false;

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, { attributionControl: true }).setView(RIYADH_FALLBACK, 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(mapRef.current);
      }
      const map = mapRef.current;

      if (layerRef.current) layerRef.current.clearLayers();
      else layerRef.current = L.layerGroup().addTo(map);
      const layer = layerRef.current;

      const dotIcon = (color: string, size = 16) =>
        L.divIcon({
          className: '',
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 3px rgba(0,0,0,.5)"></div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });

      const bounds: [number, number][] = [];
      const push = (lat: number, lng: number) => bounds.push([lat, lng]);

      // Incident fused location — cherry, with uncertainty radius circle.
      const incidentLatLng: [number, number] = [incident.latitude, incident.longitude];
      L.marker(incidentLatLng, { icon: dotIcon('#b3123b', 20) })
        .addTo(layer)
        .bindPopup(`موقع البلاغ ${incident.rescueCode}`);
      if (incident.uncertaintyRadiusMeters) {
        L.circle(incidentLatLng, {
          radius: incident.uncertaintyRadiusMeters,
          color: '#b3123b',
          fillColor: '#b3123b',
          fillOpacity: 0.08,
          weight: 1,
        }).addTo(layer);
      }
      push(...incidentLatLng);

      // Raw observations feeding the fusion — grey (agreeing) or amber (conflicting).
      observations.forEach((o) => {
        L.marker([o.latitude, o.longitude], { icon: dotIcon(o.conflicting ? '#d97706' : '#94a3b8', 10) })
          .addTo(layer)
          .bindPopup(o.provenanceLabel);
        push(o.latitude, o.longitude);
      });

      // Recommended/assigned entrance — navy.
      if (entrance) {
        L.marker([entrance.latitude, entrance.longitude], { icon: dotIcon('#0f2a4a', 16) })
          .addTo(layer)
          .bindPopup(`المدخل: ${entrance.label}`);
        push(entrance.latitude, entrance.longitude);
      }

      // Recommended/assigned unit — green.
      if (unit) {
        L.marker([unit.latitude, unit.longitude], { icon: dotIcon('#16a34a', 16) })
          .addTo(layer)
          .bindPopup(`الوحدة: ${unit.label}`);
        push(unit.latitude, unit.longitude);
        L.polyline([[unit.latitude, unit.longitude], incidentLatLng], { color: '#16a34a', weight: 2, dashArray: '4 6' }).addTo(layer);
      }

      // Alternative unit — muted green outline, no line to incident.
      if (alternativeUnit) {
        L.marker([alternativeUnit.latitude, alternativeUnit.longitude], { icon: dotIcon('#86efac', 12) })
          .addTo(layer)
          .bindPopup(`الوحدة البديلة: ${alternativeUnit.label}`);
        push(alternativeUnit.latitude, alternativeUnit.longitude);
      }

      if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30] });
      else map.setView(incidentLatLng, 15);
    });

    return () => {
      cancelled = true;
    };
  }, [incident.latitude, incident.longitude, incident.uncertaintyRadiusMeters, JSON.stringify(observations), unit?.latitude, unit?.longitude, alternativeUnit?.latitude, entrance?.latitude]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    []
  );

  return <div ref={containerRef} className="w-full h-80 rounded border border-navy/10" />;
}
