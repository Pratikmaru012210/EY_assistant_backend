from typing import List, Dict, Any

class DataStore:
    def __init__(self):
        self._excel_data: List[Dict[str, Any]] = []

    def set_data(self, data: List[Dict[str, Any]]) -> None:
        self._excel_data = data

    def get_data(self) -> List[Dict[str, Any]]:
        return self._excel_data

    def clear(self) -> None:
        self._excel_data = []

data_store = DataStore()
