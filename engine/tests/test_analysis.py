import unittest

from app.main import (
    build_dxf_topology,
    build_raster_endpoint_graph,
    candidate_labels,
    classify_symbol_name,
    extract_electrical_parameters,
)


class ElectricalAnalysisTests(unittest.TestCase):
    def test_equipment_tag_classification(self):
        expected = {
            "QF1": "circuit_breaker",
            "QS-2": "isolator",
            "CT1": "current_transformer",
            "PT-3": "voltage_transformer",
            "TR2": "transformer",
            "BUSBAR": "busbar",
            "母線": "busbar",
        }
        for label, category in expected.items():
            with self.subTest(label=label):
                self.assertEqual(classify_symbol_name(label), category)
        self.assertIsNone(classify_symbol_name("PUMP1"))

    def test_ocr_equipment_tags_include_requested_classes(self):
        blocks = [{
            "page_number": 1, "text_content": "QF1 QS2 CT1 PT1 TR1 BUSBAR",
            "confidence": 0.9, "bbox": {"x": 10, "y": 20, "width": 100, "height": 20},
        }]
        labels = candidate_labels(blocks)
        values = {item["label"] for item in labels}
        self.assertTrue({"QF1", "QS2", "CT1", "PT1", "TR1", "BUSBAR"}.issubset(values))

    def test_parameter_extraction_keeps_literal_evidence(self):
        block = {
            "page_number": 2, "text_content": "11kV 630A 100/5A 50Hz 500kVA",
            "confidence": 0.92, "bbox": {"x": 12, "y": 24, "width": 150, "height": 18},
        }
        values = {item["parameter_type"]: item["value_text"]
                  for item in extract_electrical_parameters([block])}
        self.assertEqual(values["voltage"], "11KV")
        self.assertEqual(values["current"], "630A")
        self.assertEqual(values["frequency"], "50HZ")
        self.assertEqual(values["power"], "500KVA")
        self.assertIn("100/5", values["ct_ratio"])

    def test_dxf_topology_connects_coincident_endpoints(self):
        topology = build_dxf_topology([
            {"type": "LINE", "start": [0, 0], "end": [10, 0]},
            {"type": "LINE", "start": [10, 0], "end": [20, 0]},
        ])
        self.assertEqual(topology["node_count"], 3)
        self.assertEqual(topology["edge_count"], 2)
        self.assertEqual(topology["nodes"][1]["degree"], 2)

    def test_raster_graph_does_not_claim_crossing_lines_connected(self):
        graph = build_raster_endpoint_graph([
            {"start": [0, 5], "end": [10, 5], "length": 10},
            {"start": [5, 0], "end": [5, 10], "length": 10},
        ], tolerance=1)
        self.assertEqual(graph["edge_count"], 2)
        self.assertEqual(graph["node_count"], 4)
        self.assertEqual(graph["method"], "raster_hough_endpoint_clustering_not_electrical_connectivity")


if __name__ == "__main__":
    unittest.main()
