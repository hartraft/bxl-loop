#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using Stopwatch = System.Diagnostics.Stopwatch;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace BrusselsLoop.Prototype
{
    /// <summary>
    /// P0 greybox importer for the existing Brussels Loop bake.
    /// Coordinates are already in the Brussels web-world frame: X east, Z south, metres.
    /// </summary>
    public static class BrusselsP0Importer
    {
        private const float DefaultRadiusMetres = 450f;

        [MenuItem("Brussels Loop/Import P0 scene")]
        private static void Import()
        {
            var jsonPath = EditorUtility.OpenFilePanel("Select brx-geo.json", Application.dataPath, "json");
            if (string.IsNullOrEmpty(jsonPath)) return;
            var binPath = EditorUtility.OpenFilePanel("Select brx-buildings.bin", Path.GetDirectoryName(jsonPath), "bin");
            if (string.IsNullOrEmpty(binPath)) return;

            var radius = EditorUtility.DisplayDialogComplex("P0 import radius",
                "Import the initial Grand-Place test area (900 m diameter)?", "450 m radius", "Cancel", "750 m radius");
            if (radius == 1) return;
            var radiusMetres = radius == 2 ? 750f : DefaultRadiusMetres;

            var watch = Stopwatch.StartNew();
            try
            {
                var geo = JObject.Parse(File.ReadAllText(jsonPath));
                var root = new GameObject("Brussels P0 (greybox)");
                Undo.RegisterCreatedObjectUndo(root, "Import Brussels P0");
                var roads = BuildRoadMesh((JArray)geo["roads"], radiusMetres);
                var buildings = BuildBuildingMesh(binPath, radiusMetres);

                AddMesh(root.transform, "Roads", roads, new Color(0.19f, 0.20f, 0.21f));
                AddMesh(root.transform, "Building masses", buildings, new Color(0.62f, 0.57f, 0.49f));

                watch.Stop();
                Debug.Log($"[Brussels P0] imported roads={roads.vertexCount / 4}, building vertices={buildings.vertexCount}, radius={radiusMetres:0}m in {watch.Elapsed.TotalSeconds:0.00}s. Geometry is a greybox; validate against browser screenshots.");
                Selection.activeGameObject = root;
                EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
            }
            catch (Exception ex)
            {
                Debug.LogException(ex);
                EditorUtility.DisplayDialog("Brussels P0 import failed", ex.Message, "OK");
            }
        }

        private static Mesh BuildRoadMesh(JArray roads, float radius)
        {
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            foreach (JArray road in roads)
            {
                var width = (float)road[2] / 10f;
                var points = DecodeDelta((JArray)road[6]);
                if (points.Count < 2 || !NearRadius(points, radius + width)) continue;
                for (var i = 1; i < points.Count; i++)
                {
                    var a = points[i - 1]; var b = points[i];
                    if (DistanceToOrigin(a, b) > radius + width) continue;
                    var d = (b - a).normalized;
                    var n = new Vector2(-d.y, d.x) * Mathf.Max(1.5f, width * 0.5f);
                    var start = vertices.Count;
                    vertices.Add(new Vector3(a.x + n.x, 0.035f, a.y + n.y));
                    vertices.Add(new Vector3(a.x - n.x, 0.035f, a.y - n.y));
                    vertices.Add(new Vector3(b.x - n.x, 0.035f, b.y - n.y));
                    vertices.Add(new Vector3(b.x + n.x, 0.035f, b.y + n.y));
                    triangles.Add(start); triangles.Add(start + 1); triangles.Add(start + 2);
                    triangles.Add(start); triangles.Add(start + 2); triangles.Add(start + 3);
                }
            }
            return MakeMesh("Brussels roads", vertices, triangles);
        }

        private static Mesh BuildBuildingMesh(string path, float radius)
        {
            var bytes = File.ReadAllBytes(path);
            using (var reader = new BinaryReader(new MemoryStream(bytes)))
            {
                if (new string(reader.ReadChars(4)) != "BXLB") throw new InvalidDataException("Building binary magic is not BXLB.");
                reader.ReadUInt32(); // version
                var count = checked((int)reader.ReadUInt32());
                var pointCount = checked((int)reader.ReadUInt32());
                var sectionCount = checked((int)reader.ReadUInt32());
                if (sectionCount < 11) throw new InvalidDataException("Unexpected BXLB section count.");
                var offsets = new int[sectionCount];
                for (var i = 0; i < sectionCount; i++) offsets[i] = checked((int)reader.ReadUInt32());
                var ringStart = new uint[count + 1];
                reader.BaseStream.Position = offsets[0];
                for (var i = 0; i < ringStart.Length; i++) ringStart[i] = reader.ReadUInt32();
                var origins = new int[count * 2];
                reader.BaseStream.Position = offsets[1];
                for (var i = 0; i < origins.Length; i++) origins[i] = reader.ReadInt32();
                var deltas = new short[pointCount * 2];
                reader.BaseStream.Position = offsets[4];
                for (var i = 0; i < deltas.Length; i++) deltas[i] = reader.ReadInt16();
                var heights = new ushort[count];
                reader.BaseStream.Position = offsets[5];
                for (var i = 0; i < count; i++) heights[i] = reader.ReadUInt16();

                var vertices = new List<Vector3>();
                var triangles = new List<int>();
                for (var b = 0; b < count; b++)
                {
                    var first = checked((int)ringStart[b]);
                    var last = checked((int)ringStart[b + 1]);
                    if (last - first < 3) continue;
                    var polygon = new List<Vector2>(last - first);
                    var x = origins[b * 2]; var z = origins[b * 2 + 1];
                    for (var p = first; p < last; p++)
                    {
                        x += deltas[p * 2]; z += deltas[p * 2 + 1];
                        polygon.Add(new Vector2(x / 10f, z / 10f));
                    }
                    if (!NearRadius(polygon, radius)) continue;
                    var height = Mathf.Clamp(heights[b] / 10f, 2.5f, 100f);
                    ExtrudePolygon(polygon, height, vertices, triangles);
                }
                return MakeMesh("Brussels building masses", vertices, triangles);
            }
        }

        private static void ExtrudePolygon(List<Vector2> polygon, float height, List<Vector3> vertices, List<int> triangles)
        {
            var baseIndex = vertices.Count;
            var area = SignedArea(polygon);
            var order = new List<int>();
            for (var i = 0; i < polygon.Count; i++) order.Add(i);
            if (area < 0) order.Reverse();

            // Ear clipping handles the concave footprints common in city blocks.
            var guard = polygon.Count * polygon.Count;
            var roofTriangles = new List<int>();
            while (order.Count > 2 && guard-- > 0)
            {
                var clipped = false;
                for (var i = 0; i < order.Count; i++)
                {
                    var prev = order[(i + order.Count - 1) % order.Count];
                    var curr = order[i];
                    var next = order[(i + 1) % order.Count];
                    if (Cross(polygon[prev], polygon[curr], polygon[next]) <= 0.0001f) continue;
                    var contains = false;
                    for (var j = 0; j < order.Count; j++)
                    {
                        var test = order[j];
                        if (test == prev || test == curr || test == next) continue;
                        if (PointInTriangle(polygon[test], polygon[prev], polygon[curr], polygon[next])) { contains = true; break; }
                    }
                    if (contains) continue;
                    roofTriangles.Add(prev); roofTriangles.Add(curr); roofTriangles.Add(next);
                    order.RemoveAt(i); clipped = true; break;
                }
                if (!clipped) break;
            }
            if (order.Count == 3) { roofTriangles.Add(order[0]); roofTriangles.Add(order[1]); roofTriangles.Add(order[2]); }

            for (var i = 0; i < polygon.Count; i++) vertices.Add(new Vector3(polygon[i].x, height, polygon[i].y));
            for (var i = 0; i < roofTriangles.Count; i += 3)
            {
                triangles.Add(baseIndex + roofTriangles[i]);
                triangles.Add(baseIndex + roofTriangles[i + 2]);
                triangles.Add(baseIndex + roofTriangles[i + 1]);
            }
            for (var i = 0; i < polygon.Count; i++)
            {
                var next = (i + 1) % polygon.Count;
                var wall = vertices.Count;
                var a = polygon[i]; var b = polygon[next];
                vertices.Add(new Vector3(a.x, 0, a.y)); vertices.Add(new Vector3(b.x, 0, b.y));
                vertices.Add(new Vector3(b.x, height, b.y)); vertices.Add(new Vector3(a.x, height, a.y));
                triangles.Add(wall); triangles.Add(wall + 2); triangles.Add(wall + 1);
                triangles.Add(wall); triangles.Add(wall + 3); triangles.Add(wall + 2);
            }
        }

        private static List<Vector2> DecodeDelta(JArray encoded)
        {
            var result = new List<Vector2>(encoded.Count / 2);
            var x = 0; var z = 0;
            for (var i = 0; i + 1 < encoded.Count; i += 2)
            {
                x += (int)encoded[i]; z += (int)encoded[i + 1];
                result.Add(new Vector2(x / 10f, z / 10f));
            }
            return result;
        }

        private static bool NearRadius(List<Vector2> points, float radius)
        {
            foreach (var p in points) if (p.sqrMagnitude <= radius * radius) return true;
            return false;
        }

        private static float DistanceToOrigin(Vector2 a, Vector2 b)
        {
            var ab = b - a;
            var t = ab.sqrMagnitude < 0.0001f ? 0 : Mathf.Clamp01(-Vector2.Dot(a, ab) / ab.sqrMagnitude);
            return (a + ab * t).magnitude;
        }

        private static float SignedArea(List<Vector2> p)
        {
            var sum = 0f;
            for (var i = 0; i < p.Count; i++) { var a = p[i]; var b = p[(i + 1) % p.Count]; sum += a.x * b.y - b.x * a.y; }
            return sum * 0.5f;
        }

        private static float Cross(Vector2 a, Vector2 b, Vector2 c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        private static bool PointInTriangle(Vector2 p, Vector2 a, Vector2 b, Vector2 c)
        {
            var d1 = Cross(p, a, b); var d2 = Cross(p, b, c); var d3 = Cross(p, c, a);
            return !(d1 < 0 && d2 > 0 || d2 < 0 && d3 > 0 || d3 < 0 && d1 > 0);
        }

        private static Mesh MakeMesh(string name, List<Vector3> vertices, List<int> triangles)
        {
            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(vertices); mesh.SetTriangles(triangles, 0); mesh.RecalculateNormals(); mesh.RecalculateBounds();
            return mesh;
        }

        private static void AddMesh(Transform parent, string name, Mesh mesh, Color color)
        {
            var go = new GameObject(name); go.transform.SetParent(parent, false);
            var filter = go.AddComponent<MeshFilter>(); filter.sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var material = new Material(shader) { color = color };
            renderer.sharedMaterial = material;
        }
    }
}
#endif
